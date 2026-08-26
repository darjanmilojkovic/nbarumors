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
 * Per-game stats for everyone who appeared, from Basketball-Reference.
 *
 * The NBA's own leaderboard lists only players who met a games/minutes
 * threshold, which quietly erased anyone who missed a stretch of the season.
 * Joel Embiid — a former MVP averaging 26.9 points — scored 0 prominence and
 * ranked below two-way signings, because as far as our data was concerned he
 * had not played. This page carries all 963 players instead of ~230.
 *
 * No NBA player id here, so this fills stats only; ids come from the league
 * leaders and, failing that, from Wikidata.
 */
export async function fetchBrefSeason(season: string): Promise<SeasonStat[]> {
  // "2025-26" is the 2026 season file.
  const endYear = Number(season.slice(0, 4)) + 1;
  const res = await fetch(
    `https://www.basketball-reference.com/leagues/NBA_${endYear}_per_game.html`,
    { headers: { "User-Agent": NBA_HEADERS["User-Agent"] } },
  );
  if (!res.ok) throw new Error(`bref ${season}: HTTP ${res.status}`);
  const html = await res.text();

  const stat = (row: string, name: string) => {
    const m = row.match(new RegExp(`data-stat="${name}"[^>]*>([^<]*)<`));
    return m ? Number(m[1]) : NaN;
  };

  const best = new Map<string, SeasonStat>();
  for (const row of html.split('data-append-csv="').slice(1)) {
    const name = row.match(/">([^<]+)<\/a><\/td>/)?.[1];
    if (!name) continue;
    const points = stat(row, "pts_per_g");
    const games = stat(row, "games");
    if (!Number.isFinite(points) || !Number.isFinite(games)) continue;

    /*
     * A player traded mid-season gets one row per club plus a combined row.
     * Keeping the row with the most games takes the combined one, which is the
     * season we actually want to score.
     */
    const key = nameKey(name);
    const prev = best.get(key);
    if (!prev || games > prev.gamesPlayed) {
      best.set(key, {
        nbaPlayerId: "",
        name,
        gamesPlayed: games,
        minutes: stat(row, "mp_per_g") || 0,
        points,
      });
    }
  }
  return [...best.values()];
}

/**
 * Season scoring leaders. Returns qualified players only (~230), which is the
 * right shape for prominence: a player who never qualified is, by definition,
 * not prominent this season.
 */
export async function fetchSeasonLeaders(
  season: string,
  statCategory = "PTS",
): Promise<SeasonStat[]> {
  const url =
    `https://stats.nba.com/stats/leagueLeaders?LeagueID=00&PerMode=PerGame` +
    `&Scope=S&Season=${season}&SeasonType=Regular%20Season&StatCategory=${statCategory}`;

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

/**
 * NBA player ids for as much of the league as we can reach.
 *
 * Each leaderboard only lists players who qualified in that category, so a
 * low-scoring rebounder is missing from PTS but present in REB. Union across
 * categories and recent seasons to recover ids — and therefore headshots —
 * for players the scoring list alone never covers.
 */
export async function fetchPlayerIds(
  seasons = ["2025-26", "2024-25", "2023-24"],
  categories = ["PTS", "REB", "AST", "MIN", "BLK", "STL"],
  onProgress?: (label: string, found: number) => void,
): Promise<Map<string, { nbaPlayerId: string; name: string }>> {
  const ids = new Map<string, { nbaPlayerId: string; name: string }>();

  for (const season of seasons) {
    for (const category of categories) {
      try {
        const rows = await fetchSeasonLeaders(season, category);
        for (const r of rows) {
          const key = nameKey(r.name);
          if (!ids.has(key)) ids.set(key, { nbaPlayerId: r.nbaPlayerId, name: r.name });
        }
        onProgress?.(`${season}/${category}`, ids.size);
      } catch {
        onProgress?.(`${season}/${category}:ERR`, ids.size);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return ids;
}

/** NBA CDN headshot, available once we know the player's NBA id. */
export const headshotUrl = (nbaPlayerId: string) =>
  `https://cdn.nba.com/headshots/nba/latest/1040x760/${nbaPlayerId}.png`;
