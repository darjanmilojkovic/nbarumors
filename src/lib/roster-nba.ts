import { eq, sql } from "drizzle-orm";
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
 * ROSTERS NO LONGER COME FROM IT (29 Sep 2026): the file stopped updating on
 * 15 June and rosters now come from nba.com's live index — see
 * fetchLeagueIndex. It is still the right source for ids and names, which is
 * all it is used for now: 5,126 players, retired ones included.
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

const LEAGUE_INDEX_URL = "https://www.nba.com/players";

export type LeagueIndexEntry = { nbaPlayerId: string; nbaTeamId: string };

/**
 * Everyone on an NBA roster right now, with their club, from nba.com itself.
 *
 * The page behind www.nba.com/players embeds the league's player index in its
 * Next.js payload: one row per rostered player with TEAM_ID. It is current —
 * on 29 Sep 2026 it had AJ Dybantsa at Washington and Ben Simmons at
 * Sacramento — where stats_ptsd.js, the file this replaced for rosters, was
 * still the build of 15 June: no 2026 draft class, no summer moves. That file
 * also went backwards: a copy built on 28 August was served once, stamped 66
 * rookies as active with no club, and was never served again.
 *
 * Proven from a deployment, not a laptop, before anything depended on it: a
 * probe route on Vercel fetched it in 180ms with all 618 rows (29 Sep 2026).
 * The /stats/ API that has the same data hangs from Vercel.
 *
 * Refuses a result that looks wrong rather than writing it. An index of 400
 * players, or rows without clubs, means the page changed shape, and applying
 * it would strip clubs from hundreds of real players.
 */
export async function fetchLeagueIndex(): Promise<LeagueIndexEntry[]> {
  const res = await fetch(LEAGUE_INDEX_URL, {
    headers: { "User-Agent": HEADERS["User-Agent"], Accept: "text/html" },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`nba.com/players: HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!m) throw new Error("nba.com/players: no __NEXT_DATA__ payload");
  const rows = (JSON.parse(m[1]).props?.pageProps?.players ?? []) as {
    PERSON_ID?: number;
    TEAM_ID?: number;
  }[];

  const entries = rows
    .filter((r) => r.PERSON_ID && r.TEAM_ID)
    .map((r) => ({ nbaPlayerId: String(r.PERSON_ID), nbaTeamId: String(r.TEAM_ID) }));
  // A league roster is 15 standard plus 3 two-way deals for 30 clubs: ~540.
  if (entries.length < 450 || entries.length < rows.length * 0.95) {
    throw new Error(
      `nba.com/players: ${entries.length} of ${rows.length} rows usable; refusing to write`,
    );
  }
  return entries;
}

/**
 * Write the league's live roster onto our players.
 *
 * Every player we hold an NBA id for is stamped, listed or not. Listed means
 * roster_team_id is his club; unlisted means roster_team_id is null — the
 * league saying "on no roster". That second half is new and is the point:
 * nothing used to record a player leaving the league, so Vasilije Micic,
 * waived by Milwaukee in July 2025 and gone to Europe, still read Milwaukee
 * fifteen months later, as did 36 others.
 *
 * The stamp is the fetch time, because the page is live. It does not simply
 * win: current-team.ts ranks it against our own posts and the transaction feed
 * by date, backdating an absence far enough that a camp deal we reported this
 * month survives the index not listing camp contracts yet.
 *
 * is_active follows the index exactly. It gates who /players lists without a
 * post, and "on a roster today" is the question it answers.
 *
 * Only players we already hold are touched; the index is not a reason to
 * invent rows for names no story has mentioned.
 */
export async function syncOfficialRoster(
  season = nbaSeason(),
): Promise<RosterSyncResult> {
  const index = await fetchLeagueIndex();
  const stamp = new Date();

  const teamRows = await db
    .select({ id: teams.id, nbaTeamId: teams.nbaTeamId })
    .from(teams);
  const teamByNbaId = new Map(teamRows.map((t) => [String(t.nbaTeamId), t.id]));

  const ours = await db
    .select({
      id: players.id,
      nbaPlayerId: players.nbaPlayerId,
      rosterTeamId: players.rosterTeamId,
      isActive: players.isActive,
    })
    .from(players)
    .where(sql`${players.nbaPlayerId} is not null`);

  const teamOf = new Map(
    index.map((e) => [e.nbaPlayerId, teamByNbaId.get(e.nbaTeamId) ?? null]),
  );

  let moved = 0;
  let statusChanged = 0;
  let matched = 0;
  const updates: { id: number; teamId: number | null; active: boolean }[] = [];
  for (const p of ours) {
    const listed = teamOf.has(String(p.nbaPlayerId));
    const teamId = listed ? (teamOf.get(String(p.nbaPlayerId)) ?? null) : null;
    if (listed) matched++;
    if (p.rosterTeamId !== teamId) moved++;
    if (p.isActive !== listed) statusChanged++;
    updates.push({ id: p.id, teamId, active: listed });
  }

  /*
   * One statement rather than 1,300 round trips. Every row is written, not
   * just the changed ones, so the stamp says when the league last spoke about
   * each player — which is what current-team.ts ranks on.
   */
  await db.execute(sql`
    update players p
       set roster_team_id = v.team_id,
           is_active = v.active,
           roster_synced_at = ${stamp}
      from (
        select unnest(${sql.raw(`array[${updates.map((u) => u.id).join(",") || "null"}]::int[]`)}) as id,
               unnest(${sql.raw(`array[${updates.map((u) => u.teamId ?? "null").join(",") || "null"}]::int[]`)}) as team_id,
               unnest(${sql.raw(`array[${updates.map((u) => u.active).join(",") || "null"}]::boolean[]`)}) as active
      ) v
     where p.id = v.id
  `);

  return {
    listed: index.length,
    matched,
    moved,
    season,
    generated: stamp.toISOString(),
    statusChanged,
  };
}
