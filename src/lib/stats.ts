/**
 * Player prominence inputs, all from the league itself.
 *
 *  - `leaguedashplayerstats` — every player's full per-game line, no
 *    qualification threshold. The main input, and the answer to who matters
 *    now.
 *  - `leagueLeaders` — kept for recovering NBA player ids across categories,
 *    since each leaderboard lists a different subset.
 *
 * Career standing lives in lib/awards, read from the league's own record of
 * who won what. It used to be all-time scoring rank scraped from Wikipedia,
 * which could only see points.
 *
 * This file previously scraped Basketball-Reference for the full box score and
 * carried a note that `leaguedashplayerstats` refuses us regardless of
 * headers. That was simply out of date — the same Referer and Origin sent
 * below are enough — and so were the equivalent notes about `playerindex` and
 * `commonallplayers`. Re-test before believing a comment that an endpoint is
 * closed.
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
  /*
   * Filled by the league box score, absent from the leaders endpoint. Scoring
   * alone ranked a volume shooter above a triple-double guard, so prominence
   * reads the whole line.
   */
  assists?: number;
  rebounds?: number;
  steals?: number;
  blocks?: number;
  season?: string;
};


/**
 * Prominence from a player's production over several seasons.
 *
 * Scoring average alone was a poor proxy for how much a player matters: it put
 * a volume shooter above a guard averaging a near triple-double, and it read a
 * single hot season the same as a decade of them. This reads the whole box
 * score, over as many seasons as we fetched.
 *
 * The per-game weights are the familiar efficiency shape — a steal or a block
 * is worth more than a point because they are far rarer — normalised so that a
 * genuine superstar line lands near the top of the scale rather than in the
 * middle of it.
 *
 * Recent seasons count for more, but not overwhelmingly: a star who missed
 * this year should not fall behind a career backup having a good run. And
 * seasons played is credited on its own, because sustaining that production is
 * itself the signal that separates a star from one good year.
 */
export function productionScore(seasons: SeasonStat[]): number {
  if (seasons.length === 0) return 0;

  const value = (s: SeasonStat) =>
    s.points +
    1.2 * (s.assists ?? 0) +
    0.9 * (s.rebounds ?? 0) +
    2.2 * (s.steals ?? 0) +
    2.2 * (s.blocks ?? 0);

  // Newest first, so the weight falls away with age.
  const ordered = [...seasons].sort((a, b) =>
    (b.season ?? "").localeCompare(a.season ?? ""),
  );

  let weighted = 0;
  let weightSum = 0;
  for (const [i, s] of ordered.entries()) {
    const recency = Math.pow(0.75, i);
    // A 12-game cameo should not carry the same weight as a full season.
    const played = Math.min(1, s.gamesPlayed / 45);
    const w = recency * (0.4 + 0.6 * played);
    weighted += value(s) * w;
    weightSum += w;
  }
  const production = weightSum > 0 ? weighted / weightSum : 0;

  /*
   * Calibrated against the real distribution rather than guessed. Across 1,096
   * players the weighted line runs: median 11.5, p90 26.3, p97 37.1, p99 40.7,
   * and a maximum of 51.1 (Giannis).
   *
   * Saturating at 40 — the 99th percentile — is deliberate. To a reader,
   * Jokic and Curry are both simply "superstar"; splitting hairs between 100
   * and 93 is a distinction the site never needs to draw. So the top tier is
   * flat by design and every established star lands at the ceiling.
   *
   * That compression is why the Marquee badge keys off the ceiling itself
   * rather than an arbitrary cut-off — see WireItem.
   */
  /*
   * How much of a career this actually is.
   *
   * The per-season weight above discounts a short season, but it appears in
   * both the numerator and the denominator of the average, so with a single
   * season it cancels out completely. Elijah Bryant played one game in 2020-21,
   * scored 16 in it, and rated 62 — ahead of rotation regulars — because one
   * game of 16 points averages exactly as well as eighty do.
   *
   * Basketball-Reference hid this by not matching those players; the league's
   * box score lists everyone who appeared, so it surfaced immediately.
   */
  const totalGames = seasons.reduce((n, s) => n + s.gamesPlayed, 0);
  const reliability = Math.min(1, totalGames / 40);

  const core = 88 * Math.min(1, production / 40) * reliability;
  const longevity = 12 * Math.min(1, seasons.length / 6);

  return Math.max(0, Math.min(100, Math.round(core + longevity)));
}

/**
 * Every player's full per-game line for a season, scraped.
 *
 * This was `leaguedashplayerstats` for one day, and that was a mistake I made
 * on evidence from the wrong machine. The endpoint answers from a laptop and
 * DOES NOT ANSWER FROM VERCEL: measured twice from a deployed route in iad1,
 * once with an 8s budget and once with 45s, it never responded at all. Nor do
 * `playerawards`, `playerindex` or `commonallplayers`.
 *
 * It is not the whole host, which is what I wrongly concluded first:
 * `leagueLeaders` is a `/stats/` path and answers in 135ms. It is these
 * specific endpoints, and they are exactly the heavy ones.
 *
 * Basketball-Reference answers from iad1 in 206ms, verified from the same
 * deployment. So the reasons it was replaced — that the league's own box score
 * has no qualification threshold and carries the whole line — are worth less
 * than a source that actually responds in production.
 *
 * The two reasons it was scraped in the first place still hold: this page
 * carries every player who appeared rather than the ~230 who met a threshold,
 * and it has assists, rebounds, steals and blocks rather than points alone.
 *
 * No NBA player id here. Ids come from `fetchSeasonLeaders`, which works.
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

  /*
   * Read to the end of the cell and strip any markup, rather than taking the
   * text immediately after ">".
   *
   * Basketball-Reference bolds whoever led the league in a category:
   *   data-stat="pts_per_g" ><strong>33.1</strong></td>
   * A regex stopping at the first "<" captured an empty string there, so every
   * category leader in every season parsed as zero — the bug silently erased
   * exactly the players it mattered most to get right. Joel Embiid led scoring
   * in 2021-22 and 2022-23 and was recorded with 0 points in both.
   */
  const stat = (row: string, name: string) => {
    const m = row.match(new RegExp(`data-stat="${name}"[^>]*>(.*?)</td>`, "s"));
    return m ? Number(m[1].replace(/<[^>]*>/g, "").trim()) : NaN;
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
        assists: stat(row, "ast_per_g") || 0,
        rebounds: stat(row, "trb_per_g") || 0,
        steals: stat(row, "stl_per_g") || 0,
        blocks: stat(row, "blk_per_g") || 0,
        season,
      });
    }
  }
  return [...best.values()];
}

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
 * now, and a rising star leading the league in scoring should rank on that
 * alone with no career behind him at all.
 *
 * Career standing adds up to 35 so an aging star or a recently retired name
 * still ranks above a journeyman having a hot month. That used to be all-time
 * scoring rank, which could only see points and so gave nothing to a Defensive
 * Player of the Year or a career playmaker. It is now the accolade score from
 * lib/awards, already on the same 0-35 scale, so it arrives ready to add
 * rather than needing tiers here.
 *
 * The season half still weights points most heavily; the rest of the box score
 * reaches the rating through productionScore, which reads six seasons of it.
 */
export function prominenceScore(
  season: SeasonStat | undefined,
  accolades = 0,
): number {
  let score = 0;

  if (season) {
    const pts = Math.min(1, season.points / 32);
    const min = Math.min(1, season.minutes / 36);
    // Someone with 4 games played is noise, not a star.
    const played = Math.min(1, season.gamesPlayed / 40);
    score += 65 * (0.65 * pts + 0.25 * min + 0.1 * played);
  }

  score += Math.max(0, Math.min(35, accolades));

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

/*
 * The CDN headshot builder used to live here as well. Headshots are served
 * from public/ now, and lib/images owns both the source URL and the cached
 * path so the two cannot drift apart.
 */
