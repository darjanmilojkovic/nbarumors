import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { players, teams } from "@/db/schema";

/**
 * The league's own answer to "who plays where".
 *
 * `stats.nba.com/stats/playerindex` states each player's club outright, which
 * is a better thing to have than the inference we were making from the
 * transaction feed — that took the latest arrival row and concluded a team,
 * and it breaks whenever a move never produces a row we recognise.
 *
 * The predecessor to this file scraped all thirty Basketball-Reference team
 * pages with a spoofed browser User-Agent, and its comment asserted that every
 * NBA endpoint refuses us — `commonallplayers`, `playerindex` and the CDN
 * static JSON alike. That was true when it was written and is no longer:
 * `playerindex` and `commonallplayers` both answer with the same nba.com
 * Referer and Origin headers the stats sync already uses. Only the CDN static
 * file still 403s.
 *
 * Checked against 549 of our players before this replaced anything: 530 agreed
 * with what we had computed, 14 disagreed and 5 we had no team for. Every one
 * of the 14 was a move from the last few days — the official roster is more
 * accurate and slower, which is why `roster_synced_at` exists.
 */

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
  Accept: "application/json, text/plain, */*",
};

/**
 * The NBA's season string for a given date.
 *
 * The turnover is 1 JULY, when the league year begins and free agency opens —
 * not October, when games start. Between those two dates the rosters that
 * matter are next season's, and they are the whole subject of this site.
 *
 * Getting this wrong is silent and total. Keyed to October, this returned
 * 2025-26 in August 2026 and the index answered with last season's rosters:
 * 530 players agreed with what we held on the right season and only 424 on
 * the wrong one, and writing it moved 153 players back to clubs they had
 * already left. It fails by being plausible — a 200, a full 582 rows, and
 * every name in it real.
 */
export function nbaSeason(now = new Date()): string {
  const year = now.getUTCFullYear();
  // getUTCMonth is zero-based, so 6 is July.
  const start = now.getUTCMonth() >= 6 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export type RosterEntry = { nbaPlayerId: string; nbaTeamId: string | null };

/** Every player the league currently lists, with the club it puts them at. */
export async function fetchOfficialRoster(
  season = nbaSeason(),
): Promise<RosterEntry[]> {
  const url =
    `https://stats.nba.com/stats/playerindex?LeagueID=00&Season=${season}` +
    `&Historical=0&TeamID=0`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`playerindex: HTTP ${res.status}`);

  const json = (await res.json()) as {
    resultSets: { headers: string[]; rowSet: unknown[][] }[];
  };
  const set = json.resultSets[0];
  const at = (name: string) => set.headers.indexOf(name);
  const iPerson = at("PERSON_ID");
  const iTeam = at("TEAM_ID");
  if (iPerson < 0 || iTeam < 0) {
    throw new Error(`playerindex: unexpected columns ${set.headers.join(",")}`);
  }

  return set.rowSet.map((row) => {
    const team = String(row[iTeam] ?? "");
    return {
      nbaPlayerId: String(row[iPerson]),
      // TEAM_ID 0 means unsigned, which is a fact rather than a gap.
      nbaTeamId: team && team !== "0" ? team : null,
    };
  });
}

/**
 * Fill in NBA player ids we are missing, from the league's all-time index.
 *
 * `Historical=1` returns 5,208 players rather than the 582 on current rosters,
 * which is the difference between rating a retired star and rating him zero.
 * Carmelo Anthony had no id, so his awards were never read and he scored
 * nothing at all on the career half — a top-ten all-time scorer sorting below
 * two-way signings.
 *
 * Matched on name, since an id is exactly what we lack. Suffixes are tolerated
 * in both directions: the league writes "Marcus Morris Sr." where we hold
 * "Marcus Morris", and only one of the two spellings can be right.
 */
export async function backfillPlayerIds(): Promise<{
  indexed: number;
  matched: number;
}> {
  const season = nbaSeason();
  const res = await fetch(
    `https://stats.nba.com/stats/playerindex?LeagueID=00&Season=${season}` +
      `&Historical=1&TeamID=0`,
    { headers: HEADERS },
  );
  if (!res.ok) throw new Error(`playerindex historical: HTTP ${res.status}`);
  const json = (await res.json()) as {
    resultSets: { headers: string[]; rowSet: unknown[][] }[];
  };
  const set = json.resultSets[0];
  const iId = set.headers.indexOf("PERSON_ID");
  const iFirst = set.headers.indexOf("PLAYER_FIRST_NAME");
  const iLast = set.headers.indexOf("PLAYER_LAST_NAME");

  const SUFFIX = /\s+(jr|sr|ii|iii|iv|v)\.?$/i;
  const key = (name: string) =>
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(SUFFIX, "")
      .replace(/[^a-z ]/g, "")
      .replace(/\s+/g, " ")
      .trim();

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
  const strict = (name: string) =>
    name
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z ]/g, "")
      .replace(/\s+/g, " ")
      .trim();

  for (const row of set.rowSet) {
    const name = `${row[iFirst]} ${row[iLast]}`;
    const id = String(row[iId]);
    if (!exact.has(strict(name))) exact.set(strict(name), id);
    const k = key(name);
    const seen = loose.get(k) ?? new Set<string>();
    seen.add(id);
    loose.set(k, seen);
  }

  const lookup = (name: string): string | undefined => {
    const hit = exact.get(strict(name));
    if (hit) return hit;
    const candidates = loose.get(key(name));
    return candidates?.size === 1 ? [...candidates][0] : undefined;
  };

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

  return { indexed: set.rowSet.length, matched };
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
 * `commonallplayers` carries a ROSTERSTATUS flag across all 5,208 players it
 * has ever listed, which is the one thing no amount of inference gets right.
 * Absence from the current roster index cannot tell a retirement from an
 * unsigned free agent, and both are common in an offseason: Chris Paul and
 * Russell Westbrook retired, while a free agent who signs next week is just as
 * absent today. Guessing either way mislabels the other.
 *
 * TO_YEAR comes along for free and says when a career ended.
 */
export async function fetchRosterStatus(
  season = nbaSeason(),
): Promise<RosterStatus[]> {
  const res = await fetch(
    `https://stats.nba.com/stats/commonallplayers?LeagueID=00` +
      `&Season=${season}&IsOnlyCurrentSeason=0`,
    { headers: HEADERS },
  );
  if (!res.ok) throw new Error(`commonallplayers: HTTP ${res.status}`);

  const json = (await res.json()) as {
    resultSets: { headers: string[]; rowSet: unknown[][] }[];
  };
  const set = json.resultSets[0];
  const at = (n: string) => set.headers.indexOf(n);
  const iId = at("PERSON_ID");
  const iStatus = at("ROSTERSTATUS");
  const iTo = at("TO_YEAR");
  if (iId < 0 || iStatus < 0) {
    throw new Error(`commonallplayers: columns ${set.headers.join(",")}`);
  }

  return set.rowSet.map((row) => ({
    nbaPlayerId: String(row[iId]),
    active: Number(row[iStatus]) === 1,
    toYear: iTo >= 0 ? (Number(row[iTo]) || null) : null,
  }));
}

export type RosterSyncResult = {
  listed: number;
  matched: number;
  moved: number;
  season: string;
  /** Players whose active flag changed. */
  statusChanged: number;
};

/**
 * Write the league's roster onto our players, stamping when it spoke.
 *
 * Only players we already hold are touched. The index carries names we have
 * never seen, and inventing rows for them here would fill the directory with
 * people no story has ever mentioned.
 */
export async function syncOfficialRoster(
  season = nbaSeason(),
): Promise<RosterSyncResult> {
  const roster = await fetchOfficialRoster(season);
  if (roster.length === 0) {
    // An empty index means the request shape changed, not that the league
    // emptied. Refusing to write is the difference between a stale roster and
    // a wiped one.
    throw new Error("playerindex returned no rows; refusing to write");
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

  const now = new Date();
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
      .set({ currentTeamId: teamId, rosterSyncedAt: now })
      .where(eq(players.id, player.id));
  }

  /*
   * Then the active flag, straight from ROSTERSTATUS.
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
   * Players we hold no NBA id for are left alone: the feed never had a chance
   * to mention them, and marking them inactive on that basis is what the old
   * scraper did when it opened by setting the whole table false.
   */
  let statusChanged = 0;
  try {
    const status = await fetchRosterStatus(season);
    const active = new Set(
      status.filter((s) => s.active).map((s) => s.nbaPlayerId),
    );
    if (active.size === 0) throw new Error("no active players in the response");

    /*
     * Plus anyone our own completed reporting has just signed somewhere.
     *
     * ROSTERSTATUS lags the same way the roster does. DeMar DeRozan signed for
     * Denver in a post dated 21 August and the league still had him at
     * status 0, last season 2025 — indistinguishable from Chris Paul, who
     * actually retired. The difference is that DeRozan has a completed signing
     * behind him and Paul does not, which is a question our own data answers.
     */
    const recentlySigned = await db.execute(sql`
      select distinct p.nba_player_id
      from players p
      join rumor_players rp on rp.player_id = p.id
      join rumors r on r.id = rp.rumor_id
      where p.nba_player_id is not null
        and r.is_published
        and r.status in ('completed', 'confirmed')
        and r.published_at > now() - interval '30 days'
        and (
          rp.to_team_id is not null
          or exists (
            select 1 from rumor_teams rt
            where rt.rumor_id = r.id and rt.role = 'to'
          )
        )
    `);
    for (const row of (recentlySigned.rows ?? recentlySigned) as unknown as {
      nba_player_id: string;
    }[]) {
      active.add(String(row.nba_player_id));
    }

    const known = status.map((s) => s.nbaPlayerId);
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

  void sql;
  return { listed: roster.length, matched: byNbaId.size, moved, season, statusChanged };
}
