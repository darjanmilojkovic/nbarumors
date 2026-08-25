/**
 * Player prominence inputs.
 *
 * Two sources, because they answer different questions:
 *  - Current-season leaders (stats.nba.com) — who matters *now*.
 *  - All-time scoring (Wikipedia) — who matters regardless of this season's
 *    box score. A 40-year-old legend on a minutes limit still outranks a
 *    high-usage role player.
 *
 * Endpoints deliberately NOT used: stats.nba.com `leaguedashplayerstats` and
 * `alltimeleadersgrids` both refuse our requests regardless of headers, and
 * nba.com/stats/* pages are client-rendered so there is nothing in the HTML.
 */

const NBA_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
  Accept: "application/json, text/plain, */*",
};

export type SeasonStat = {
  nbaPlayerId: string;
  name: string;
  gamesPlayed: number;
  minutes: number;
  points: number;
};

/**
 * Season scoring leaders. Returns qualified players only (~230), which is the
 * right shape for prominence: a player who never qualified is, by definition,
 * not prominent this season.
 */
export async function fetchSeasonLeaders(season: string): Promise<SeasonStat[]> {
  const url =
    `https://stats.nba.com/stats/leagueLeaders?LeagueID=00&PerMode=PerGame` +
    `&Scope=S&Season=${season}&SeasonType=Regular%20Season&StatCategory=PTS`;

  const res = await fetch(url, { headers: NBA_HEADERS });
  if (!res.ok) throw new Error(`nba stats ${season}: HTTP ${res.status}`);

  const data = (await res.json()) as {
    resultSet?: { headers: string[]; rowSet: unknown[][] };
    resultSets?: { headers: string[]; rowSet: unknown[][] }[];
  };
  const rs = data.resultSet ?? data.resultSets?.[0];
  if (!rs) throw new Error(`nba stats ${season}: unexpected shape`);

  const col = (n: string) => rs.headers.indexOf(n);
  const iId = col("PLAYER_ID");
  const iName = col("PLAYER");
  const iGp = col("GP");
  const iMin = col("MIN");
  const iPts = col("PTS");

  return rs.rowSet.map((r) => ({
    nbaPlayerId: String(r[iId]),
    name: String(r[iName]),
    gamesPlayed: Number(r[iGp]) || 0,
    minutes: Number(r[iMin]) || 0,
    points: Number(r[iPts]) || 0,
  }));
}

/**
 * All-time scoring rank, by name. Wikipedia's table is stable enough to parse
 * and is the only one of the suggested sources that serves career totals in
 * plain HTML.
 */
export async function fetchCareerScoringRanks(): Promise<Map<string, number>> {
  const res = await fetch(
    "https://en.wikipedia.org/wiki/List_of_NBA_career_scoring_leaders",
    { headers: { "User-Agent": "nbarumors.cc/0.1 (+https://nbarumors.cc)" } },
  );
  if (!res.ok) throw new Error(`wikipedia: HTTP ${res.status}`);
  const html = await res.text();

  const ranks = new Map<string, number>();
  let rank = 0;

  // Rows look like: <tr>...<td><a href="/wiki/LeBron_James" title="LeBron James">
  for (const row of html.split("<tr")) {
    const link = row.match(/\/wiki\/[^"]+"\s+title="([^"]+)"/);
    if (!link) continue;
    const name = link[1];
    // Skip footnote/reference and non-player links.
    if (/^(List|NBA|National|Basketball|\d)/.test(name)) continue;
    if (!/^[A-Z][\p{L}'.\- ]+ [\p{L}'.\- ]+$/u.test(name)) continue;
    if (ranks.has(name)) continue;
    ranks.set(name, ++rank);
    if (rank >= 250) break;
  }
  return ranks;
}

/** Normalized for matching — "Luka Dončić" and "Luka Doncic" collapse. */
export const nameKey = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Blend the two signals into 0-100.
 *
 * Season form dominates (up to 65) because the site is about who is moving
 * now; career standing adds up to 35 so that an aging star or a recently
 * retired name still ranks above a journeyman having a hot month.
 */
export function prominenceScore(
  season: SeasonStat | undefined,
  careerRank: number | undefined,
): number {
  let score = 0;

  if (season) {
    const pts = Math.min(1, season.points / 32);
    const min = Math.min(1, season.minutes / 36);
    // Someone with 4 games played is noise, not a star.
    const played = Math.min(1, season.gamesPlayed / 40);
    score += 65 * (0.65 * pts + 0.25 * min + 0.1 * played);
  }

  if (careerRank != null) {
    if (careerRank <= 10) score += 35;
    else if (careerRank <= 25) score += 30;
    else if (careerRank <= 50) score += 24;
    else if (careerRank <= 100) score += 16;
    else score += 8;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/** NBA CDN headshot, available once we know the player's NBA id. */
export const headshotUrl = (nbaPlayerId: string) =>
  `https://cdn.nba.com/headshots/nba/latest/1040x760/${nbaPlayerId}.png`;
