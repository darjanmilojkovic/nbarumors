import { config } from "dotenv";
config({ path: ".env.local" });
import { eq, isNull, sql } from "drizzle-orm";

/**
 * Fill in NBA player ids (and therefore headshots) for players the scoring
 * leaderboard alone never covers. `npm run sync:headshots`
 */
async function main() {
  const { db } = await import("@/db");
  const { players } = await import("@/db/schema");
  const { fetchPlayerIds, headshotUrl, nameKey } = await import("@/lib/stats");

  const [before] = await db
    .select({
      have: sql<number>`count(*) filter (where ${players.headshotUrl} is not null)::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(players)
    .where(eq(players.isActive, true));
  console.log(`before: ${before.have}/${before.total} active players have a headshot\n`);

  const ids = await fetchPlayerIds(undefined, undefined, (label, found) =>
    process.stdout.write(`  ${label}→${found}`),
  );
  console.log(`\n\nunique NBA ids collected: ${ids.size}`);

  const missing = await db
    .select({ id: players.id, fullName: players.fullName })
    .from(players)
    .where(isNull(players.headshotUrl));

  let filled = 0;
  for (const p of missing) {
    const hit = ids.get(nameKey(p.fullName));
    if (!hit) continue;
    await db
      .update(players)
      .set({ nbaPlayerId: hit.nbaPlayerId, headshotUrl: headshotUrl(hit.nbaPlayerId) })
      .where(eq(players.id, p.id));
    filled++;
  }

  const [after] = await db
    .select({
      have: sql<number>`count(*) filter (where ${players.headshotUrl} is not null)::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(players)
    .where(eq(players.isActive, true));

  console.log(`filled ${filled} missing headshots`);
  console.log(`after:  ${after.have}/${after.total} active players have a headshot`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
