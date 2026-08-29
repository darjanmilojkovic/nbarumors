export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * TEMPORARY. Can this deployment reach the sources sync-stats needs?
 *
 * Two questions, and the second matters as much as the first:
 *
 *   1. Do the endpoints sync-stats calls today answer? (Expected: no. Every
 *      stats.nba.com/stats/ path hung until a 12s abort in the last probe.)
 *   2. Does the Basketball-Reference / Wikipedia path it REPLACED answer?
 *      I asserted it did without testing, which is the same mistake that put
 *      the unreachable endpoints there. Basketball Reference is behind
 *      Cloudflare and may well refuse a datacenter IP.
 *
 * If (2) is also dead, reverting is not a repair and prominence needs a
 * different source entirely. Removed as soon as it has answered.
 */
const NBA_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
  Accept: "application/json, text/plain, */*",
};

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const POLITE_HEADERS = {
  "User-Agent": "nbarumors.cc/0.1 (+https://nbarumors.cc)",
};

const TARGETS: [string, string, Record<string, string>][] = [
  // What sync-stats calls today.
  [
    "current: leaguedashplayerstats",
    "https://stats.nba.com/stats/leaguedashplayerstats?LeagueID=00&Season=2025-26" +
      "&SeasonType=Regular+Season&PerMode=PerGame&MeasureType=Base&PaceAdjust=N" +
      "&PlusMinus=N&Rank=N&Outcome=&Location=&Month=0&SeasonSegment=&DateFrom=" +
      "&DateTo=&OpponentTeamID=0&VsConference=&VsDivision=&TeamID=0&Conference=" +
      "&Division=&GameSegment=&Period=0&LastNGames=0&PlayerExperience=" +
      "&PlayerPosition=&StarterBench=&DraftYear=&DraftPick=&College=&Country=" +
      "&Height=&Weight=&TwoWay=0&ShotClockRange=&GameScope=&PORound=0",
    NBA_HEADERS,
  ],
  ["current: leagueLeaders", "https://stats.nba.com/stats/leagueLeaders?LeagueID=00&PerMode=PerGame&Scope=S&Season=2025-26&SeasonType=Regular+Season&StatCategory=PTS", NBA_HEADERS],
  // What it replaced.
  ["replaced: basketball-reference per_game", "https://www.basketball-reference.com/leagues/NBA_2026_per_game.html", BROWSER_HEADERS],
  ["replaced: wikipedia career scoring", "https://en.wikipedia.org/wiki/List_of_NBA_career_scoring_leaders", POLITE_HEADERS],
  // A third option, if both above are dead: the static tree that does answer.
  ["control: ptsd directory", "https://stats.nba.com/js/data/ptsd/stats_ptsd.js", NBA_HEADERS],
];

export async function GET() {
  const results = [];
  for (const [name, url, headers] of TARGETS) {
    const started = Date.now();
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { headers, signal: ctrl.signal });
      clearTimeout(timer);
      const text = await res.text();
      results.push({
        name,
        status: res.status,
        ms: Date.now() - started,
        bytes: text.length,
        // Enough to tell a real page from a Cloudflare interstitial.
        head: text.slice(0, 120).replace(/\s+/g, " "),
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
