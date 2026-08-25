import { config } from "dotenv";
config({ path: ".env.local" });
import { eq, sql } from "drizzle-orm";

/**
 * Refresh player prominence from NBA season stats + all-time scoring.
 * `npm run sync:stats` — safe to re-run; it only updates existing players
 * and inserts leaders we haven't seen yet.
 */
async function main() {
  const { db } = await import("@/db");
  const { players } = await import("@/db/schema");
  const {
    fetchSeasonLeaders,
    fetchCareerScoringRanks,
    prominenceScore,
    headshotUrl,
    nameKey,
  } = await import("@/lib/stats");

  // Two seasons: early in a new season the current one is thin, so the better
  // of the two keeps ratings stable through October.
  const seasons = ["2025-26", "2024-25"];
  const bySeason = new Map<string, Awaited<ReturnType<typeof fetchSeasonLeaders>>>();
  for (const s of seasons) {
    try {
      const rows = await fetchSeasonLeaders(s);
      bySeason.set(s, rows);
      console.log(`  ${s}: ${rows.length} qualified players`);
    } catch (err) {
      console.log(`  ${s}: FAILED — ${err instanceof Error ? err.message : err}`);
    }
  }

  let career = new Map<string, number>();
  try {
    career = await fetchCareerScoringRanks();
    console.log(`  all-time scoring: ${career.size} players`);
  } catch (err) {
    console.log(`  all-time scoring: FAILED — ${err instanceof Error ? err.message : err}`);
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

  const existing = await db
    .select({ id: players.id, slug: players.slug, fullName: players.fullName })
    .from(players);
  console.log(`\n  players in db: ${existing.length}`);

  let updated = 0;
  for (const p of existing) {
    const k = nameKey(p.fullName);
    const season = best.get(k);
    const rank = careerByKey.get(k);
    const score = prominenceScore(season, rank);

    await db
      .update(players)
      .set({
        prominence: score,
        pointsPerGame: season?.points ?? null,
        statsSyncedAt: new Date(),
        ...(season
          ? {
              nbaPlayerId: season.nbaPlayerId,
              headshotUrl: headshotUrl(season.nbaPlayerId),
            }
          : {}),
      })
      .where(eq(players.id, p.id));
    if (score > 0) updated++;
  }
  console.log(`  scored: ${updated} of ${existing.length}`);

  // Seed the rest of the league so /players isn't limited to names that
  // happen to have appeared in a rumor yet.
  const slugify = (s: string) =>
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  let inserted = 0;
  for (const [k, s] of best) {
    const rows = await db
      .insert(players)
      .values({
        slug: slugify(s.name),
        fullName: s.name,
        aliases: [k],
        nbaPlayerId: s.nbaPlayerId,
        headshotUrl: headshotUrl(s.nbaPlayerId),
        prominence: prominenceScore(s, careerByKey.get(k)),
        pointsPerGame: s.points,
        statsSyncedAt: new Date(),
      })
      .onConflictDoNothing({ target: players.slug })
      .returning({ id: players.id });
    if (rows.length > 0) inserted++;
  }
  console.log(`  new players added from leaders: ${inserted}`);

  const top = await db
    .select({ name: players.fullName, p: players.prominence, ppg: players.pointsPerGame })
    .from(players)
    .orderBy(sql`${players.prominence} desc`)
    .limit(8);
  console.log("\n  top prominence:");
  for (const t of top) {
    console.log(`    ${String(t.p).padStart(3)}  ${t.name}${t.ppg ? ` (${t.ppg} ppg)` : ""}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
