import { sql } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import {
  fetchBrefSeason,
  fetchSeasonLeaders,
  fetchCareerScoringRanks,
  prominenceScore,
  productionScore,
  headshotUrl,
  nameKey,
} from "@/lib/stats";

export type StatsSyncResult = {
  seasons: Record<string, number | string>;
  careerRanks: number | string;
  playersInDb: number;
  scored: number;
  inserted: number;
  top: { name: string; prominence: number; ppg: number | null }[];
};

/**
 * The two seasons worth pulling, derived from today rather than hard-coded.
 *
 * Early in a new season the current one is a handful of games, so we take the
 * better line of the current and previous season — that keeps ratings stable
 * through October instead of letting one hot week rewrite the league. The NBA
 * labels a season by the year it starts, and play begins in October, so
 * anything before October still belongs to the season that began last year.
 */
function recentSeasons(now = new Date()): [string, string] {
  const startYear =
    now.getUTCMonth() >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const label = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  return [label(startYear), label(startYear - 1)];
}

/**
 * How far back the production history goes. Six seasons is enough to tell a
 * sustained star from one good year, without letting a player who retired into
 * a bench role keep coasting on a decade-old peak.
 */
const HISTORY_SEASONS = 6;

function seasonHistory(now = new Date()): string[] {
  const startYear =
    now.getUTCMonth() >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return Array.from(
    { length: HISTORY_SEASONS },
    (_, i) => `${startYear - i}-${String((startYear - i + 1) % 100).padStart(2, "0")}`,
  );
}

const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Refresh player prominence from NBA season stats + all-time scoring.
 *
 * Safe to re-run: it updates the players we have and inserts leaders we have
 * not seen. Both writes are single statements rather than a row-at-a-time
 * loop — against serverless Postgres, 600 sequential round trips took longer
 * than a cron invocation is allowed to run.
 */
export async function runStatsSync(): Promise<StatsSyncResult> {
  const result: StatsSyncResult = {
    seasons: {},
    careerRanks: 0,
    playersInDb: 0,
    scored: 0,
    inserted: 0,
    top: [],
  };

  const bySeason = new Map<string, Awaited<ReturnType<typeof fetchSeasonLeaders>>>();
  for (const s of recentSeasons()) {
    try {
      const rows = await fetchSeasonLeaders(s);
      bySeason.set(s, rows);
      result.seasons[s] = rows.length;
    } catch (err) {
      // A failed upstream fetch must not wipe the ratings we already have.
      result.seasons[s] = `failed: ${err instanceof Error ? err.message : err}`;
    }
  }

  let career = new Map<string, number>();
  try {
    career = await fetchCareerScoringRanks();
    result.careerRanks = career.size;
  } catch (err) {
    result.careerRanks = `failed: ${err instanceof Error ? err.message : err}`;
  }
  const careerByKey = new Map(
    [...career.entries()].map(([name, rank]) => [nameKey(name), rank]),
  );

  // Best season line per player across the seasons we fetched.
  const best = new Map<string, Awaited<ReturnType<typeof fetchSeasonLeaders>>[number]>();
  for (const rows of bySeason.values()) {
    for (const r of rows) {
      const k = nameKey(r.name);
      const prev = best.get(k);
      if (!prev || r.points > prev.points) best.set(k, r);
    }
  }

  /*
   * Then everyone the league's own leaderboard leaves out. It lists only
   * players who met a games threshold, so a former MVP who missed half a
   * season scored 0 and ranked below two-way signings. Basketball-Reference
   * publishes all 963 players who appeared, which is the population we
   * actually want to rate.
   *
   * NBA rows win where both exist — they carry the player id — so this only
   * ever fills gaps.
   */
  const history = new Map<string, Awaited<ReturnType<typeof fetchBrefSeason>>>();
  for (const season of seasonHistory()) {
    try {
      const rows = await fetchBrefSeason(season);
      for (const r of rows) {
        const k = nameKey(r.name);
        history.set(k, [...(history.get(k) ?? []), r]);
        const prev = best.get(k);
        if (!prev || (!prev.nbaPlayerId && r.points > prev.points)) best.set(k, r);
      }
      result.seasons[`${season} (bref)`] = rows.length;
    } catch (err) {
      result.seasons[`${season} (bref)`] =
        `failed: ${err instanceof Error ? err.message : err}`;
    }
  }

  /*
   * If every upstream fetch failed there is nothing to apply, and running the
   * update anyway would zero the prominence of the entire league.
   */
  if (best.size === 0) {
    throw new Error("no season data fetched — refusing to zero prominence");
  }

  const existing = await db
    .select({ id: players.id, fullName: players.fullName })
    .from(players);
  result.playersInDb = existing.length;

  const updates = existing.map((p) => {
    const k = nameKey(p.fullName);
    const season = best.get(k);
    /*
     * Production history first, since it reads the whole box score over six
     * seasons. The single-season formula is the fallback for anyone
     * Basketball-Reference does not cover, and the all-time scoring rank still
     * lifts the handful of players who have one.
     */
    const seasons = history.get(k);
    const score = seasons?.length
      ? Math.max(
          productionScore(seasons),
          prominenceScore(season, careerByKey.get(k)),
        )
      : prominenceScore(season, careerByKey.get(k));
    return {
      id: p.id,
      score,
      ppg: season?.points ?? null,
      /*
       * Empty, not null, when the line came from Basketball-Reference — it
       * carries no player id. Coalescing an empty id into a headshot URL would
       * write ".../.png" over a photo we already had, so both fall back to null
       * and the coalesce in SQL keeps the existing value.
       */
      nbaPlayerId: season?.nbaPlayerId || null,
      headshot: season?.nbaPlayerId ? headshotUrl(season.nbaPlayerId) : null,
    };
  });
  result.scored = updates.filter((u) => u.score > 0).length;

  /*
   * One UPDATE ... FROM (VALUES ...) for the whole league. nba_player_id and
   * headshot_url use coalesce so a player who dropped out of the qualified
   * pool this season keeps the photo we already had — only the rating and the
   * scoring average are allowed to fall back to nothing.
   */
  for (let i = 0; i < updates.length; i += 500) {
    const chunk = updates.slice(i, i + 500);
    const rows = chunk.map(
      (u) =>
        // nba_player_id is varchar(16), not an integer id.
        sql`(${u.id}::int, ${u.score}::int, ${u.ppg}::real, ${u.nbaPlayerId}::varchar, ${u.headshot}::text)`,
    );
    await db.execute(sql`
      update ${players} as p set
        prominence = v.prominence,
        points_per_game = v.ppg,
        nba_player_id = coalesce(v.nba_player_id, p.nba_player_id),
        headshot_url = coalesce(v.headshot_url, p.headshot_url),
        stats_synced_at = now()
      from (values ${sql.join(rows, sql`, `)})
        as v(id, prominence, ppg, nba_player_id, headshot_url)
      where p.id = v.id
    `);
  }

  /*
   * Seed the rest of the league so /players isn't limited to names that have
   * happened to appear in a rumor, and so a player who first shows up in a
   * rumor already has a rating waiting rather than sorting as prominence 0.
   */
  const seen = new Set<string>();
  const inserts = [...best.entries()]
    .map(([k, s]) => ({
      slug: slugify(s.name),
      fullName: s.name,
      aliases: [k],
      nbaPlayerId: s.nbaPlayerId || null,
      headshotUrl: s.nbaPlayerId ? headshotUrl(s.nbaPlayerId) : null,
      prominence: Math.max(
        productionScore(history.get(k) ?? []),
        prominenceScore(s, careerByKey.get(k)),
      ),
      pointsPerGame: s.points,
      statsSyncedAt: new Date(),
    }))
    // Two players can slugify identically; the DB would reject the second.
    .filter((r) => !seen.has(r.slug) && seen.add(r.slug));

  const before = result.playersInDb;
  for (let i = 0; i < inserts.length; i += 500) {
    await db
      .insert(players)
      .values(inserts.slice(i, i + 500))
      .onConflictDoNothing({ target: players.slug });
  }
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(players);
  result.inserted = n - before;

  const top = await db
    .select({
      name: players.fullName,
      prominence: players.prominence,
      ppg: players.pointsPerGame,
    })
    .from(players)
    .orderBy(sql`${players.prominence} desc`)
    .limit(8);
  result.top = top;

  return result;
}
