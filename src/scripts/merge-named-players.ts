import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Merge one named player row into another, chosen by hand.
 *
 * `merge-duplicate-players` collapses rows that share an NBA id, which catches
 * the common case and misses this one: two rows for the same person where only
 * one carries an id. "Gary Payton Jr." arrived from an article and holds the
 * posts; "Gary Payton II" arrived from the league, holds the id, and is the
 * name the NBA uses. Neither has the other's id, so nothing groups them.
 *
 * The obvious generalisation — normalise suffixes and merge anything that
 * matches — is exactly wrong here. It collapses fathers into sons, and the
 * league is full of them: Payton, Hardaway, Porter, Wade, Rivers, Barry. Gary
 * Payton Jr. is not Gary Payton, and merging them gave the son his father's
 * 1996 Defensive Player of the Year in an earlier run of this work.
 *
 * So pairs are named explicitly and reviewed one at a time. Slower, and the
 * only version that cannot silently invent a career.
 *
 *   npx tsx src/scripts/merge-named-players.ts --dry
 *   npx tsx src/scripts/merge-named-players.ts --apply
 */

/** loser -> keeper, both by exact full_name. */
const PAIRS: [string, string][] = [["Gary Payton Jr.", "Gary Payton II"]];

async function main() {
  const apply = process.argv.includes("--apply");
  const { db } = await import("@/db");
  const { players, playerImages, playerSlugRedirects, rumorPlayers } =
    await import("@/db/schema");
  const { eq, sql } = await import("drizzle-orm");

  for (const [loserName, keeperName] of PAIRS) {
    const rows = await db
      .select()
      .from(players)
      .where(sql`${players.fullName} in (${loserName}, ${keeperName})`);
    const loser = rows.find((r) => r.fullName === loserName);
    const keeper = rows.find((r) => r.fullName === keeperName);
    if (!loser || !keeper) {
      console.log(`skip: "${loserName}" -> "${keeperName}" (one side missing)`);
      continue;
    }

    const [{ n: loserPosts }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(rumorPlayers)
      .where(eq(rumorPlayers.playerId, loser.id));

    console.log(
      `\n"${loserName}" (id ${loser.id}, ${loserPosts} tags, nba ${loser.nbaPlayerId ?? "-"})` +
        ` -> "${keeperName}" (id ${keeper.id}, nba ${keeper.nbaPlayerId ?? "-"})`,
    );
    console.log(`  aliases become: ${JSON.stringify([...new Set([...keeper.aliases, ...loser.aliases])])}`);
    if (!apply) continue;

    /*
     * The loser's slug is kept as a redirect. Its page may have been linked or
     * indexed, and a 404 is a worse outcome than a hop.
     */
    await db
      .insert(playerSlugRedirects)
      .values({ fromSlug: loser.slug, playerId: keeper.id })
      .onConflictDoNothing();

    // Repoint the tags. A post naming both rows would violate the composite
    // key, so those are dropped rather than duplicated.
    await db.execute(sql`
      update rumor_players rp set player_id = ${keeper.id}
      where rp.player_id = ${loser.id}
        and not exists (
          select 1 from rumor_players x
          where x.rumor_id = rp.rumor_id and x.player_id = ${keeper.id}
        )
    `);
    await db
      .delete(rumorPlayers)
      .where(eq(rumorPlayers.playerId, loser.id));
    await db
      .update(playerImages)
      .set({ playerId: keeper.id })
      .where(eq(playerImages.playerId, loser.id));

    await db
      .update(players)
      .set({
        aliases: [...new Set([...keeper.aliases, ...loser.aliases])],
        prominence: Math.max(keeper.prominence, loser.prominence),
      })
      .where(eq(players.id, keeper.id));

    await db.delete(players).where(eq(players.id, loser.id));
    console.log(`  merged`);
  }

  if (!apply) console.log(`\ndry run — pass --apply`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
