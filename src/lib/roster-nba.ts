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

export type RosterSyncResult = {
  listed: number;
  matched: number;
  moved: number;
  season: string;
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

  void sql;
  return { listed: roster.length, matched: byNbaId.size, moved, season };
}
