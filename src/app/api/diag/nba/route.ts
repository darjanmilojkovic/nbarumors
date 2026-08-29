export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * TEMPORARY, second pass. Which NBA data can this deployment actually reach?
 *
 * The first probe established that stats.nba.com/stats/* hangs from iad1 while
 * the static player-movement JSON on the same host answers in 173ms. So the
 * host is reachable and the API path is not, which means the roster and awards
 * syncs need a static source rather than a different machine.
 *
 * These are the candidates. Removed as soon as it has answered.
 */
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
  Accept: "application/json, text/plain, */*",
};

const TARGETS: [string, string][] = [
  // Known good, as a control.
  ["control: playermovement", "https://stats.nba.com/js/data/playermovement/NBA_Player_Movement.json"],
  // The long-standing static player directory: id, name, team, roster status.
  ["js/data ptsd player directory", "https://stats.nba.com/js/data/ptsd/stats_ptsd.js"],
  // cdn.nba.com static data.
  ["cdn staticData PlayerIndex", "https://cdn.nba.com/static/json/staticData/PlayerIndex_20.json"],
  ["cdn staticData scheduleLeagueV2", "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json"],
  ["cdn liveData todaysScoreboard", "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json"],
  // The older data.nba.net tree, which was static JSON rather than an API.
  ["data.nba.net players", "https://data.nba.net/prod/v1/2026/players.json"],
  ["data.nba.net teams", "https://data.nba.net/prod/v2/2026/teams.json"],
  // A headshot, to confirm the image CDN is reachable from here too.
  ["cdn headshot", "https://cdn.nba.com/headshots/nba/latest/1040x760/2544.png"],
];

export async function GET() {
  const results = [];
  for (const [name, url] of TARGETS) {
    const started = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
      clearTimeout(timer);
      const buf = await res.arrayBuffer();
      results.push({
        name,
        status: res.status,
        ms: Date.now() - started,
        bytes: buf.byteLength,
      });
    } catch (err) {
      results.push({
        name,
        status: null,
        ms: Date.now() - started,
        error: err instanceof Error ? err.name : String(err),
      });
    }
  }
  return Response.json({ region: process.env.VERCEL_REGION ?? null, results });
}
