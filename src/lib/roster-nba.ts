import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { players, teams } from "@/db/schema";

/**
 * The league's own answer to "who plays where".
 *
 * This used to read `stats.nba.com/stats/playerindex` and `commonallplayers`,
 * which work from a laptop and DO NOT WORK FROM VERCEL. Measured from a
 * throwaway route deployed to iad1: every `/stats/` path hung until a 12s
 * abort, while a static file on the same host answered in 173ms. The comments
 * this file replaced had said as much — "403 or hang" — and I overruled them on
 * the strength of local tests. They were describing the environment that
 * matters. So the rule is: anything a cron depends on must be proven from a
 * deployment, not from here.
 *
 * What does answer is `js/data/ptsd/stats_ptsd.js`, the directory that powers
 * nba.com's own search box: 5,126 players with an id, an active flag, first and
 * last season, and a team slug, plus the 30 clubs with their numeric ids. It is
 * a snapshot rather than a live query — the copy read while writing this was
 * generated on 15 June 2026 — so it is authoritative and OLD, and it says so.
 *
 * That is why it composes. `current-team.ts` already ranks the roster, the
 * transaction feed and our own reporting by date, and the transaction feed
 * (`playermovement`, also static, also reachable) was current to yesterday and
 * carried the 302 moves made since the snapshot. Baseline plus deltas.
 */

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
  Accept: "application/json, text/plain, */*",
};

const DIRECTORY_URL = "https://stats.nba.com/js/data/ptsd/stats_ptsd.js";

/*
 * Row shapes, by position. The file is arrays rather than objects, which is
 * what keeps it small enough to be a static asset.
 *
 *   player: [id, "Last, First", active, fromYear, toYear, _, teamSlug]
 *   team:   [id, abbrev, slug, city, name, ...]
 */
type PlayerRow = [number, string, number, number, number, number, string];
type TeamRow = [string, string, string, string, string, ...unknown[]];

export type Directory = {
  /** When the league built this snapshot, ISO with offset. */
  generated: string;
  players: PlayerRow[];
  teams: TeamRow[];
};

/**
 * One download per process. A sync run asks for the roster, the status flags
 * and sometimes the id backfill, and all three are views of the same 228KB.
 */
let cached: { at: number; value: Directory } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export async function fetchDirectory(): Promise<Directory> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const res = await fetch(DIRECTORY_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`stats_ptsd: HTTP ${res.status}`);

  /*
   * The response is JavaScript, not JSON: `var stats_ptsd = {...};`. Slice from
   * the first brace and drop a trailing semicolon rather than eval it.
   */
  const raw = await res.text();
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("stats_ptsd: no object in response");
  const parsed = JSON.parse(raw.slice(start).replace(/;\s*$/, "")) as {
    generated?: string;
    data?: { players?: PlayerRow[]; teams?: TeamRow[] };
  };

  const players = parsed.data?.players;
  const teamRows = parsed.data?.teams;
  if (!Array.isArray(players) || !Array.isArray(teamRows)) {
    throw new Error("stats_ptsd: unexpected shape");
  }

  const value: Directory = {
    generated: parsed.generated ?? new Date().toISOString(),
    players,
    teams: teamRows,
  };
  cached = { at: Date.now(), value };
  return value;
}

/** Slug ("timberwolves") to the league's numeric team id. */
export function teamIdBySlug(dir: Directory): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of dir.teams) {
    const [id, , slug] = row;
    // The file carries G-League and All-Star sides too; they have no slug.
    if (slug) map.set(slug, String(id));
  }
  return map;
}

/** "Abdul-Jabbar, Kareem" as we hold it: "Kareem Abdul-Jabbar". */
function displayName(listed: string): string {
  const comma = listed.indexOf(",");
  if (comma < 0) return listed.trim();
  const last = listed.slice(0, comma).trim();
  const first = listed.slice(comma + 1).trim();
  return first ? `${first} ${last}` : last;
}

/**
 * The season string the rest of the pipeline labels a sync with.
 *
 * The turnover is 1 JULY, when the league year begins and free agency opens —
 * not October, when games start. Between those two dates the rosters that
 * matter are next season's, and they are the whole subject of this site.
 *
 * Getting this wrong was silent and total. Keyed to October, this returned
 * 2025-26 in August 2026 and the index answered with last season's rosters:
 * writing it moved 153 players back to clubs they had already left. It failed
 * by being plausible — a 200, a full 582 rows, every name in it real.
 */
export function nbaSeason(now = new Date()): string {
  const year = now.getUTCFullYear();
  // getUTCMonth is zero-based, so 6 is July.
  const start = now.getUTCMonth() >= 6 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export type RosterEntry = { nbaPlayerId: string; nbaTeamId: string | null };

/** Every player the league currently lists, with the club it puts them at. */
export async function fetchOfficialRoster(): Promise<RosterEntry[]> {
  const dir = await fetchDirectory();
  const bySlug = teamIdBySlug(dir);

  return dir.players
    .filter((row) => Number(row[2]) === 1)
    .map((row) => ({
      nbaPlayerId: String(row[0]),
      // No slug means unsigned, which is a fact rather than a gap.
      nbaTeamId: row[6] ? (bySlug.get(row[6]) ?? null) : null,
    }));
}

/**
 * Fill in NBA player ids we are missing, from the whole directory.
 *
 * All 5,126 players are in the file, not just the 530 on current rosters, which
 * is the difference between rating a retired star and rating him zero. Carmelo
 * Anthony had no id, so his awards were never read and he scored nothing at all
 * on the career half — a top-ten all-time scorer sorting below two-way signings.
 *
 * Matched on name, since an id is exactly what we lack. Suffixes are tolerated
 * in both directions: the league writes "Marcus Morris Sr." where we hold
 * "Marcus Morris", and only one of the two spellings can be right.
 */
export async function backfillPlayerIds(): Promise<{
  indexed: number;
  matched: number;
}> {
  const dir = await fetchDirectory();
  const lookup = buildNameResolver(dir);

  const missing = await db
    .select({ id: players.id, fullName: players.fullName })
    .from(players)
    .where(sql`${players.nbaPlayerId} is null`);

  /*
   * The id is unique, and stripping suffixes to match names means two of our
   * rows can land on one player: "Marcus Morris" and "Marcus Morris Sr." are
   * the same person, and one of them is a duplicate we have not merged yet.
   * Taking every id already in use, plus the ones assigned during this run,
   * makes the second claim a no-op rather than a crash.
   */
  const used = new Set(
    (
      await db
        .select({ nbaPlayerId: players.nbaPlayerId })
        .from(players)
        .where(sql`${players.nbaPlayerId} is not null`)
    ).map((r) => String(r.nbaPlayerId)),
  );

  let matched = 0;
  for (const p of missing) {
    const nbaId = lookup(p.fullName);
    if (!nbaId || used.has(nbaId)) continue;
    used.add(nbaId);
    await db
      .update(players)
      .set({ nbaPlayerId: nbaId })
      .where(eq(players.id, p.id));
    matched++;
  }

  return { indexed: dir.players.length, matched };
}

/**
 * Resolve a player's name to the league's id, from the directory.
 *
 * Shared with the stats sync, which scrapes a source carrying no ids at all
 * and needs them to join six seasons of history onto our rows.
 */
export function buildNameResolver(
  dir: Directory,
): (name: string) => string | undefined {
  const SUFFIX = /\s+(jr|sr|ii|iii|iv|v)\.?$/i;
  const strict = (name: string) =>
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const key = (name: string) => strict(name.replace(SUFFIX, ""));

  /*
   * Two indexes, and the loose one refuses ambiguity.
   *
   * Suffix-stripping exists because the league writes "Marcus Morris Sr."
   * where we hold "Marcus Morris". It also collapses fathers onto sons, and
   * the NBA is full of those: Payton, Hardaway, Porter, Wade, Rivers, Barry.
   * Taking the first match gave Gary Payton Jr. the 1996 Defensive Player of
   * the Year and Tim Hardaway Jr. his father's five All-Star selections —
   * both jumped from 0 to a floored 100 in a dry run.
   *
   * So an exact name wins outright, and a suffix-insensitive match is only
   * used when it lands on exactly one player.
   */
  const exact = new Map<string, string>();
  const loose = new Map<string, Set<string>>();

  for (const row of dir.players) {
    const name = displayName(String(row[1]));
    const id = String(row[0]);
    if (!exact.has(strict(name))) exact.set(strict(name), id);
    const k = key(name);
    const seen = loose.get(k) ?? new Set<string>();
    seen.add(id);
    loose.set(k, seen);
  }

  return (name: string): string | undefined => {
    const hit = exact.get(strict(name));
    if (hit) return hit;
    const candidates = loose.get(key(name));
    return candidates?.size === 1 ? [...candidates][0] : undefined;
  };
}

export type RosterStatus = {
  nbaPlayerId: string;
  active: boolean;
  /** Last season the player appeared in, e.g. 2025. */
  toYear: number | null;
};

/**
 * Who is currently on an NBA roster, as the league states it.
 *
 * The directory carries an active flag across all 5,126 players it has ever
 * listed, which is the one thing no amount of inference gets right. Absence
 * from the current roster cannot tell a retirement from an unsigned free agent,
 * and both are common in an offseason: Chris Paul and Russell Westbrook
 * retired, while a free agent who signs next week is just as absent today.
 * Guessing either way mislabels the other.
 *
 * The last season played comes along for free and says when a career ended.
 */
export async function fetchRosterStatus(): Promise<RosterStatus[]> {
  const dir = await fetchDirectory();
  return dir.players.map((row) => ({
    nbaPlayerId: String(row[0]),
    active: Number(row[2]) === 1,
    toYear: Number(row[4]) || null,
  }));
}

export type RosterSyncResult = {
  listed: number;
  matched: number;
  moved: number;
  season: string;
  /** When the league built the snapshot we read. */
  generated: string;
  /** Players whose active flag changed. */
  statusChanged: number;
};

/**
 * Write the league's roster onto our players, stamping when IT spoke.
 *
 * Only players we already hold are touched. The directory carries names we have
 * never seen, and inventing rows for them here would fill the directory with
 * people no story has ever mentioned.
 */
export async function syncOfficialRoster(
  season = nbaSeason(),
): Promise<RosterSyncResult> {
  const dir = await fetchDirectory();
  const roster = await fetchOfficialRoster();
  if (roster.length === 0) {
    // An empty directory means the file's shape changed, not that the league
    // emptied. Refusing to write is the difference between a stale roster and
    // a wiped one.
    throw new Error("stats_ptsd listed no active players; refusing to write");
  }

  const teamRows = await db
    .select({ id: teams.id, nbaTeamId: teams.nbaTeamId })
    .from(teams);
  const teamByNbaId = new Map(teamRows.map((t) => [String(t.nbaTeamId), t.id]));

  const ids = roster.map((r) => r.nbaPlayerId);
  const ours = await db
    .select({
      id: players.id,
      nbaPlayerId: players.nbaPlayerId,
      currentTeamId: players.currentTeamId,
    })
    .from(players)
    .where(inArray(players.nbaPlayerId, ids));
  const byNbaId = new Map(ours.map((p) => [String(p.nbaPlayerId), p]));

  /*
   * The snapshot's own timestamp, not now().
   *
   * This is the whole reason the source change is an improvement rather than a
   * lateral move. `roster_synced_at` used to record when we ASKED, which is
   * days after the league knew, so a fetch from five minutes ago beat a report
   * from two days ago every time — that is how a post reading "Kuminga reaches
   * 2-year deal with Timberwolves" sat under a masthead saying Atlanta Hawks.
   * current-team.ts compensated by backdating the roster a guessed seven days.
   *
   * The file states when it was built, so the guess is now a measured fact and
   * the fudge factor is gone.
   */
  const generatedAt = new Date(dir.generated);
  const stamp = Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt;

  let moved = 0;
  for (const entry of roster) {
    const player = byNbaId.get(entry.nbaPlayerId);
    if (!player) continue;
    const teamId = entry.nbaTeamId
      ? (teamByNbaId.get(entry.nbaTeamId) ?? null)
      : null;
    if (player.currentTeamId !== teamId) moved++;
    await db
      .update(players)
      .set({ currentTeamId: teamId, rosterSyncedAt: stamp })
      .where(eq(players.id, player.id));
  }

  /*
   * Then the active flag.
   *
   * is_active was orphaned when the Basketball-Reference roster scraper went,
   * exactly as current_team_id had been, and it decides who appears on
   * /players. Frozen, it had Damian Lillard, Kyrie Irving and Tyrese
   * Haliburton down as inactive while they were on rosters.
   *
   * Read rather than inferred. Absence from a roster cannot separate a
   * retirement from an unsigned free agent — Chris Paul and Russell Westbrook
   * retired, and both look identical to a free agent who signs next week. The
   * league states which is which, so nothing here has to guess.
   *
   * Players we hold no NBA id for are left alone: the file never had a chance
   * to mention them, and marking them inactive on that basis is what the old
   * scraper did when it opened by setting the whole table false.
   */
  let statusChanged = 0;
  try {
    const status = await fetchRosterStatus();
    const active = new Set(
      status.filter((s) => s.active).map((s) => s.nbaPlayerId),
    );
    if (active.size === 0) throw new Error("no active players in the file");

    /*
     * Anyone we have newer evidence about is left alone, in both directions.
     *
     * This is the guard the old source did not need and this one cannot do
     * without. `playerindex` answered as of the moment we asked, so its flag
     * was never behind ours. A snapshot built on 15 June is behind by an entire
     * offseason, and applying it wholesale regressed 44 flags in a dry run —
     * it would have marked Russell Westbrook ACTIVE again two weeks after we
     * recorded his retirement, and marked Lonnie Walker IV inactive after he
     * had signed.
     *
     * So the snapshot is authoritative only where nothing has happened since it
     * was built. A player with a transaction row or a published post after that
     * date is one we know more about than the file does, and his flag stands.
     */
    const supersededRows = await db.execute(sql`
      select distinct p.nba_player_id
      from players p
      where p.nba_player_id is not null
        and (
          exists (
            select 1 from transactions t
            where t.nba_player_id = p.nba_player_id
              and t.occurred_at > ${stamp}
          )
          or exists (
            select 1 from rumor_players rp
            join rumors r on r.id = rp.rumor_id
            where rp.player_id = p.id
              and r.is_published
              and r.published_at > ${stamp}
          )
        )
    `);
    const superseded = new Set(
      ((supersededRows.rows ?? supersededRows) as unknown as {
        nba_player_id: string;
      }[]).map((r) => String(r.nba_player_id)),
    );

    const known = status.map((s) => s.nbaPlayerId).filter((id) => !superseded.has(id));
    const rows = await db
      .select({
        id: players.id,
        nbaPlayerId: players.nbaPlayerId,
        isActive: players.isActive,
      })
      .from(players)
      .where(inArray(players.nbaPlayerId, known));

    for (const p of rows) {
      const should = active.has(String(p.nbaPlayerId));
      if (p.isActive === should) continue;
      statusChanged++;
      await db
        .update(players)
        .set({ isActive: should })
        .where(eq(players.id, p.id));
    }
  } catch {
    /*
     * The team assignments above are already written and are the more valuable
     * half. A failure here leaves the flag as it was rather than losing both.
     */
  }

  return {
    listed: roster.length,
    matched: byNbaId.size,
    moved,
    season,
    generated: dir.generated,
    statusChanged,
  };
}
