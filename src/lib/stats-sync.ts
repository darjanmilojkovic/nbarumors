import { sql } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import {
  fetchBrefSeason,
  fetchSeasonLeaders,
  prominenceScore,
  productionScore,
  nameKey,
} from "@/lib/stats";

export type StatsSyncResult = {
  seasons: Record<string, number | string>;
  /** Players whose accolade score contributed. */
  withAccolades: number;
  /** Every rating that moves, largest change first. */
  changes: { name: string; from: number; to: number; accolades: number }[];
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
/**
 * @param opts.dryRun  Compute every score and write nothing.
 *
 * Prominence decides feed ranking and which player a card leads with, so a
 * change to the formula is visible on every page at once. Being able to read
 * the diff before applying it is the difference between a considered change
 * and a surprise.
 */
export async function runStatsSync(
  opts: { dryRun?: boolean } = {},
): Promise<StatsSyncResult> {
  const result: StatsSyncResult = {
    seasons: {},
    withAccolades: 0,
    changes: [],
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
   * Then everyone the leaderboard leaves out, and every stat it omits.
   *
   * `leagueLeaders` returns only players who met a games threshold — a former
   * MVP who missed half a season scored 0 and ranked below two-way signings —
   * and only points. The scrape has no threshold and carries the whole line,
   * so assists, rebounds, steals and blocks reach productionScore.
   *
   * This was `leaguedashplayerstats` for one day, on 28 Aug 2026, because I
   * read the note saying the endpoint refuses us, tested it from a laptop and
   * called the note stale. The note was about production. Measured from a
   * deployed route, that endpoint never answers from Vercel at all — so for
   * that day this loop failed on all six seasons and the sync could not have
   * rated anyone. Reverted to the source that does answer.
   *
   * The scrape carries no player ids, and matching on name alone is not good
   * enough in either direction. Reverting on names alone cost Bobby Portis Jr.
   * 70 to 39, Xavier Tillman 33 to 0 and Elijah Bryant 39 to 9 in a dry run —
   * our rows hold the suffixed spelling and the scrape does not, which is the
   * exact mirror of the bug that hit Jimmy Butler going the other way.
   *
   * So ids are resolved from the directory file, which lists all 5,126 players
   * and IS reachable from Vercel. The resolver takes an exact name outright and
   * accepts a suffix-insensitive match only when it lands on one player, so it
   * does not merge Gary Payton Jr. onto his father.
   */
  const resolveId = await (async () => {
    try {
      const { fetchDirectory, buildNameResolver } = await import(
        "@/lib/roster-nba"
      );
      return buildNameResolver(await fetchDirectory());
    } catch {
      // Names still join for everyone whose spelling already agrees.
      return () => undefined;
    }
  })();

  const history = new Map<string, Awaited<ReturnType<typeof fetchBrefSeason>>>();
  for (const season of seasonHistory()) {
    try {
      const rows = (await fetchBrefSeason(season)).map((r) => ({
        ...r,
        nbaPlayerId: r.nbaPlayerId || (resolveId(r.name) ?? ""),
      }));
      for (const r of rows) {
        const k = nameKey(r.name);
        history.set(k, [...(history.get(k) ?? []), r]);
        const prev = best.get(k);
        if (!prev || (!prev.nbaPlayerId && r.points > prev.points)) best.set(k, r);
      }
      result.seasons[`${season} (box)`] = rows.length;
    } catch (err) {
      result.seasons[`${season} (box)`] =
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

  /*
   * Indexed by NBA player id as well as by name.
   *
   * Matching on name alone broke the moment the box score moved from
   * Basketball-Reference to the league: the NBA writes "Jimmy Butler III"
   * where the scrape said "Jimmy Butler", and "Xavier Tillman Sr." where
   * it said "Xavier Tillman". Every player carrying a suffix silently lost
   * their entire history — Butler fell from 90 to 18 in a dry run. The id
   * is exact where we have one; the name is the fallback for players the
   * league has never given us an id for.
   */
  const bestById = new Map(
    [...best.values()].filter((s) => s.nbaPlayerId).map((s) => [s.nbaPlayerId, s]),
  );
  const historyById = new Map<string, typeof history extends Map<string, infer V> ? V : never>();
  for (const rows of history.values()) {
    const withId = rows.find((r) => r.nbaPlayerId);
    if (withId) historyById.set(withId.nbaPlayerId, rows);
  }

  const existing = await db
    .select({
      id: players.id,
      fullName: players.fullName,
      nbaPlayerId: players.nbaPlayerId,
      accolades: players.accolades,
      prominenceFloor: players.prominenceFloor,
      prominence: players.prominence,
    })
    .from(players);
  result.playersInDb = existing.length;

  const updates = existing.map((p) => {
    const k = nameKey(p.fullName);
    /*
     * Our own row is resolved through the directory too, not just the scraped
     * one. Both halves have to agree on an id for the join to happen, and a
     * player we hold no id for is exactly the case where the names disagree:
     * we have "Xavier Tillman", the scrape says "Xavier Tillman Sr.", and
     * without this he matched neither by id nor by name and dropped 33 to 0.
     */
    const id = p.nbaPlayerId ?? resolveId(p.fullName) ?? "";
    const season = bestById.get(id) ?? best.get(k);
    /*
     * Production history first, since it reads the whole box score over six
     * seasons. The single-season formula is the fallback for anyone the
     * league box score does not cover.
     */
    const seasons = historyById.get(id) ?? history.get(k);
    /*
     * Accolades are the career half now, replacing all-time scoring rank.
     * That rank could only see points, so it gave nothing to a Defensive
     * Player of the Year or a career playmaker — the players a trade rumor is
     * most often about. Read from the row rather than fetched here; awards
     * change a few times a season and have their own slower sync.
     */
    const career = p.accolades;
    const computed = seasons?.length
      ? Math.min(
          100,
          Math.max(
            productionScore(seasons) + career,
            prominenceScore(season, career),
          ),
        )
      : prominenceScore(season, career);

    /*
     * An honour is a permanent fact about a career, so it sets a floor the
     * rating cannot fall below. Without it Carmelo Anthony — a top-ten
     * all-time scorer with no current season — would have dropped to 51.
     */
    const score = Math.max(computed, p.prominenceFloor);
    return {
      id: p.id,
      score,
      ppg: season?.points ?? null,
      /*
       * Empty, not null, when a line carries no player id — the
       * carries no player id, and the coalesce in SQL then keeps whatever id
       * we already had rather than blanking it.
       */
      nbaPlayerId: season?.nbaPlayerId || null,
    };
  });
  /*
   * An NBA id belongs to one row. Two of ours can still resolve to the same
   * player — "Gary Payton Jr." and "Gary Payton II" are one man under two
   * names — and proposing his id for both aborts the whole statement on a
   * unique violation, halfway through the league. Whoever already holds it
   * keeps it; the other row simply keeps whatever id it had.
   */
  const idOwner = new Map<string, number>();
  for (const p of existing) {
    if (p.nbaPlayerId) idOwner.set(String(p.nbaPlayerId), p.id);
  }
  for (const u of updates) {
    if (!u.nbaPlayerId) continue;
    const owner = idOwner.get(u.nbaPlayerId);
    if (owner !== undefined && owner !== u.id) u.nbaPlayerId = null;
    else idOwner.set(u.nbaPlayerId, u.id);
  }

  result.scored = updates.filter((u) => u.score > 0).length;
  result.withAccolades = existing.filter((p) => p.accolades > 0).length;
  result.changes = updates
    .map((u, i) => ({
      name: existing[i].fullName,
      from: existing[i].prominence,
      to: u.score,
      accolades: existing[i].accolades,
    }))
    .filter((c) => c.from !== c.to)
    .sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));

  if (opts.dryRun) return result;

  /*
   * One UPDATE ... FROM (VALUES ...) for the whole league. nba_player_id uses
   * coalesce so a player who dropped out of the qualified pool this season
   * keeps the id we already had — only the rating and the scoring average are
   * allowed to fall back to nothing.
   *
   * headshot_url is deliberately not touched here. This runs as a cron on
   * Vercel, where the filesystem is read-only, so it cannot download and
   * resize the image that a URL would promise — and we serve those ourselves
   * now. It records the NBA id; `npm run sync:images` turns ids into files
   * and files into URLs, on a machine that can write to public/.
   */
  for (let i = 0; i < updates.length; i += 500) {
    const chunk = updates.slice(i, i + 500);
    const rows = chunk.map(
      (u) =>
        // nba_player_id is varchar(16), not an integer id.
        sql`(${u.id}::int, ${u.score}::int, ${u.ppg}::real, ${u.nbaPlayerId}::varchar)`,
    );
    await db.execute(sql`
      update ${players} as p set
        prominence = v.prominence,
        points_per_game = v.ppg,
        nba_player_id = coalesce(v.nba_player_id, p.nba_player_id),
        stats_synced_at = now()
      from (values ${sql.join(rows, sql`, `)})
        as v(id, prominence, ppg, nba_player_id)
      where p.id = v.id
    `);
  }

  /*
   * Seed the rest of the league so /players isn't limited to names that have
   * happened to appear in a rumor, and so a player who first shows up in a
   * rumor already has a rating waiting rather than sorting as prominence 0.
   */
  const seen = new Set<string>();
  /*
   * A player the extraction already created is in here under the spelling the
   * article used — "Bobby Portis Jr." — while the NBA calls him "Bobby Portis".
   * The slugs differ, so onConflictDoNothing would not see the collision and
   * we would insert a second row for the same person, splitting his rumors and
   * his rating across two pages. The nba id is the one identifier both halves
   * agree on, so anyone already holding it is skipped here.
   */
  const claimedIds = new Set(
    (
      await db
        .select({ nbaPlayerId: players.nbaPlayerId })
        .from(players)
        .where(sql`${players.nbaPlayerId} is not null`)
    ).map((r) => r.nbaPlayerId as string),
  );
  const inserts = [...best.entries()]
    .map(([k, s]) => ({
      slug: slugify(s.name),
      fullName: s.name,
      aliases: [k],
      nbaPlayerId: s.nbaPlayerId || null,
      // Filled in by `npm run sync:images` once the file exists; see above.
      headshotUrl: null,
      /*
       * No accolades yet: this player has never been seen, so the awards
       * sync has not read them. The next run rates them properly.
       */
      prominence: Math.max(
        productionScore(history.get(k) ?? []),
        prominenceScore(s),
      ),
      pointsPerGame: s.points,
      statsSyncedAt: new Date(),
    }))
    .filter((r) => !(r.nbaPlayerId && claimedIds.has(r.nbaPlayerId)))
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
