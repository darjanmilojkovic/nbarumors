import { SEED_TEAMS } from "@/db/seed-data/teams";

/**
 * Active-roster source.
 *
 * Every live NBA roster endpoint refuses us — `commonallplayers`,
 * `playerindex`, and the CDN static JSON all 403 or hang, ESPN's roster API
 * 403s, and nba.com/stats pages are client-rendered. Basketball-Reference's
 * per-team pages are the one source that serves rosters as plain HTML, and
 * `/teams/` is not disallowed by their robots.txt.
 *
 * Caveat worth knowing: these are SEASON rosters. A player waived in November
 * still appears on the team he started with, so the result is a superset of
 * the ~450 players under contract on any given day.
 */

export type RosterPlayer = {
  name: string;
  teamAbbrev: string;
};

/** Basketball-Reference spells three teams differently than the NBA does. */
const TO_BBREF: Record<string, string> = {
  BKN: "BRK",
  CHA: "CHO",
  PHX: "PHO",
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36";

async function fetchTeamRoster(
  abbrev: string,
  season: number,
): Promise<RosterPlayer[]> {
  const code = TO_BBREF[abbrev] ?? abbrev;
  const res = await fetch(
    `https://www.basketball-reference.com/teams/${code}/${season}.html`,
    { headers: { "User-Agent": UA } },
  );
  if (!res.ok) throw new Error(`${abbrev}: HTTP ${res.status}`);
  const html = await res.text();

  // Bound the slice to the roster table — the page has many other tables
  // whose rows use the same data-stat="player" cells.
  const start = html.indexOf('id="roster"');
  if (start === -1) return [];
  const end = html.indexOf("</table>", start);
  const segment = html.slice(start, end === -1 ? undefined : end);

  return [
    ...segment.matchAll(/data-stat="player"[^>]*>(?:<a[^>]*>)?([^<]+)/g),
  ]
    .map((m) => m[1].trim())
    .filter((n) => n && n !== "Player")
    .map((name) => ({ name, teamAbbrev: abbrev }));
}

/**
 * Every player on an NBA roster this season, with their team.
 * Sequential with a short pause — this runs once a day, and hammering 30
 * pages in parallel is how you get blocked.
 */
export async function fetchLeagueRosters(
  season = 2026,
  onProgress?: (abbrev: string, n: number) => void,
): Promise<RosterPlayer[]> {
  const all: RosterPlayer[] = [];
  const seen = new Set<string>();

  for (const team of SEED_TEAMS) {
    try {
      const roster = await fetchTeamRoster(team.abbreviation, season);
      for (const p of roster) {
        // A traded player appears on both rosters; first team wins, and the
        // stats sync corrects the current team afterwards.
        if (seen.has(p.name)) continue;
        seen.add(p.name);
        all.push(p);
      }
      onProgress?.(team.abbreviation, roster.length);
    } catch (err) {
      onProgress?.(
        team.abbreviation,
        -1,
      );
      void err;
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return all;
}
