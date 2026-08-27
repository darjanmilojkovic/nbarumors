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
  const { fetchPlayerIds, nameKey } = await import("@/lib/stats");
  const { cacheHeadshot } = await import("@/lib/images");

  const [before] = await db
    .select({
      have: sql<number>`count(*) filter (where ${players.nbaPlayerId} is not null)::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(players)
    .where(eq(players.isActive, true));
  console.log(`before: ${before.have}/${before.total} active players have a headshot\n`);

  const ids = await fetchPlayerIds(undefined, undefined, (label, found) =>
    process.stdout.write(`  ${label}→${found}`),
  );
  console.log(`\n\nunique NBA ids collected: ${ids.size}`);

  /*
   * Keyed on the id, not the URL. headshot_url is no longer what decides
   * whether a player has a photo — the manifest in lib/cached-images does,
   * and it is built from the files on disk. The id is the thing worth
   * filling; `npm run sync:images` turns it into an image.
   */
  const missing = await db
    .select({ id: players.id, fullName: players.fullName })
    .from(players)
    .where(isNull(players.nbaPlayerId));

  /*
   * Ids already spoken for. nameKey strips the punctuation, so "A.J. Green"
   * and "AJ Green" — two rows, one person, from two spellings of the name —
   * both land on the same leaderboard entry and would both be written with
   * its id. That is a duplicate player, and now a unique-index violation.
   */
  const claimed = new Set(
    (
      await db
        .select({ nbaPlayerId: players.nbaPlayerId })
        .from(players)
        .where(sql`${players.nbaPlayerId} is not null`)
    ).map((r) => r.nbaPlayerId as string),
  );

  let filled = 0;
  let taken = 0;
  for (const p of missing) {
    const hit = ids.get(nameKey(p.fullName));
    if (!hit) continue;
    if (claimed.has(hit.nbaPlayerId)) {
      taken++;
      console.log(`  ${p.fullName}: ${hit.nbaPlayerId} already held by another row, skipped`);
      continue;
    }
    claimed.add(hit.nbaPlayerId);
    /*
     * Cache the image here — this runs on a machine that can write to
     * public/ — but record only the id. Nothing reads headshot_url any more;
     * the file on disk and the manifest built from it are what decide whether
     * a photo renders.
     */
    await cacheHeadshot(hit.nbaPlayerId);
    await db
      .update(players)
      .set({ nbaPlayerId: hit.nbaPlayerId })
      .where(eq(players.id, p.id));
    filled++;
  }

  const [after] = await db
    .select({
      have: sql<number>`count(*) filter (where ${players.nbaPlayerId} is not null)::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(players)
    .where(eq(players.isActive, true));

  console.log(`filled ${filled} missing headshots`);
  if (taken) console.log(`skipped ${taken} whose id another row already holds`);
  console.log(`after:  ${after.have}/${after.total} active players have a headshot`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
