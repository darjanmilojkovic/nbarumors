export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * TEMPORARY. Answers one question: can this deployment reach stats.nba.com?
 *
 * The roster sync inside /api/cron/sync-transactions ran last night and left no
 * trace — it is wrapped in a try/catch so a roster failure cannot lose the
 * transactions that were just imported, which also made the failure invisible.
 * The suspicion is that the /stats/ API refuses datacenter IPs while the static
 * player-movement JSON, which did work, does not.
 *
 * Deliberately unauthenticated, because the CRON_SECRET lives only in the
 * Vercel project. It returns HTTP status codes and timings and no data at all,
 * and it is removed as soon as it has answered.
 */
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
  Accept: "application/json, text/plain, */*",
};

const TARGETS: [string, string][] = [
  [
    "playerindex",
    "https://stats.nba.com/stats/playerindex?LeagueID=00&Season=2026-27&Historical=0&TeamID=0",
  ],
  [
    "commonallplayers",
    "https://stats.nba.com/stats/commonallplayers?LeagueID=00&Season=2026-27&IsOnlyCurrentSeason=1",
  ],
  [
    "playerawards",
    "https://stats.nba.com/stats/playerawards?PlayerID=2544",
  ],
  [
    "playermovement (static, known working)",
    "https://stats.nba.com/js/data/playermovement/NBA_Player_Movement.json",
  ],
];

export async function GET() {
  const results = [];
  for (const [name, url] of TARGETS) {
    const started = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12_000);
      const res = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
      clearTimeout(timer);
      // Read a little so a body that never arrives shows as a timeout here.
      const text = (await res.text()).slice(0, 120);
      results.push({
        name,
        status: res.status,
        ms: Date.now() - started,
        bodyStartsWith: text.slice(0, 60),
      });
    } catch (err) {
      results.push({
        name,
        status: null,
        ms: Date.now() - started,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
    }
  }
  return Response.json({ region: process.env.VERCEL_REGION ?? null, results });
}
