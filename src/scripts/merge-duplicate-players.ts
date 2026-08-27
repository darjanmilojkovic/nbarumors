import { config } from "dotenv";
config({ path: ".env.local" });
import { and, eq, sql } from "drizzle-orm";

/**
 * Collapse players that exist twice under the same NBA id.
 *
 * A player reaches the table by two different doors. The extraction meets a
 * name in an article and `resolvePlayer` creates a row for it verbatim —
 * "Bobby Portis Jr.", slug bobby-portis-jr. The stats sync later seeds the
 * league from the NBA's own feed, which spells him "Bobby Portis", slugifies
 * to bobby-portis, finds no slug collision and inserts a second row. Both then
 * end up with the same nba_player_id: the leaderboard hands one to the seeded
 * row, and the Wikidata sync — which strips "Jr." to match — hands the same id
 * to the other.
 *
 * The damage is a split identity. Rumors land on whichever row the extraction
 * tagged, so the player's page shows half his posts, and prominence, which
 * drives feed ranking, is computed twice from two partial pictures.
 *
 * Merging keeps the row that already carries the rumors, since that is the
 * page that has been linked and indexed, but takes the better value for every
 * field from either row: the fuller display name, the union of the aliases,
 * the roster fields from whichever row the sync marked active, the higher
 * prominence. Then rumor_players and player_images are repointed at it and the
 * loser is deleted.
 *
 * Safe to re-run: every step reads current state, so a run that dies halfway
 * leaves a smaller version of the same problem rather than a broken one.
 *
 * Run this before `npm run db:migrate` adds the unique index on
 * nba_player_id — with duplicates still in the table, the index will not build.
 *
 *   npm run merge:players -- --dry
 *   npm run merge:players
 */

type PlayerRow = {
  id: number;
  slug: string;
  fullName: string;
  aliases: string[];
  position: string | null;
  currentTeamId: number | null;
  prominence: number;
  isActive: boolean;
  pointsPerGame: number | null;
  statsSyncedAt: Date | null;
  headshotUrl: string | null;
  rumorCount: number;
};

async function main() {
  const dryRun = process.argv.includes("--dry");
  const { db } = await import("@/db");
  const { players, playerImages, playerSlugRedirects, rumorPlayers } = await import(
    "@/db/schema"
  );

  const groupRes = await db.execute(sql`
    select nba_player_id from players
     where nba_player_id is not null
     group by nba_player_id having count(*) > 1
     order by nba_player_id`);
  const groups = ((groupRes.rows ?? groupRes) as { nba_player_id: string }[]).map(
    (g) => g.nba_player_id,
  );

  console.log(`${groups.length} nba ids held by more than one player row\n`);

  const summary = {
    merged: 0,
    deleted: 0,
    rumorsRepointed: 0,
    rumorsFolded: 0,
    imagesRepointed: 0,
    imagesDemoted: 0,
  };

  for (const nbaId of groups) {
    const rows = (await db
      .select({
        id: players.id,
        slug: players.slug,
        fullName: players.fullName,
        aliases: players.aliases,
        position: players.position,
        currentTeamId: players.currentTeamId,
        prominence: players.prominence,
        isActive: players.isActive,
        pointsPerGame: players.pointsPerGame,
        statsSyncedAt: players.statsSyncedAt,
        headshotUrl: players.headshotUrl,
        rumorCount: sql<number>`(
          select count(*)::int from ${rumorPlayers}
           where ${rumorPlayers.playerId} = ${players.id})`,
      })
      .from(players)
      .where(eq(players.nbaPlayerId, nbaId))) as PlayerRow[];

    /*
     * Inbound rumors decide it — that row's page is the one already linked and
     * in the sitemap. The rest is tie-breaking for a pair the extraction never
     * tagged: prefer the row the roster sync is keeping current, then the
     * better-rated, then the older id.
     */
    rows.sort(
      (a, b) =>
        b.rumorCount - a.rumorCount ||
        Number(b.isActive) - Number(a.isActive) ||
        b.prominence - a.prominence ||
        a.id - b.id,
    );
    const [keeper, ...losers] = rows;

    const tally = (r: PlayerRow) =>
      `${r.slug} (#${r.id}, ${r.rumorCount} rumor${r.rumorCount === 1 ? "" : "s"})`;
    console.log(
      `${nbaId}  KEEP ${tally(keeper)}  DROP ${losers.map(tally).join(", ")}`,
    );

    // The fuller spelling is the one a reader should see: "Bobby Portis Jr.".
    const fullName = rows.reduce((best, r) =>
      r.fullName.length > best.fullName.length ? r : best,
    ).fullName;
    /*
     * The rating and the scoring average travel together, from whichever row
     * scored higher. Both sides were synced in the same pass seconds apart, so
     * the timestamps cannot say which reading is better — but the two halves
     * of a split player see different slices of the season, and the one that
     * scored higher is the one that saw more of it.
     */
    const statsRow = rows.reduce((best, r) =>
      r.prominence > best.prominence ? r : best,
    );
    const firstOf = <T>(pick: (r: PlayerRow) => T | null): T | null =>
      rows.map(pick).find((v) => v !== null && v !== undefined) ?? null;

    const merged = {
      fullName,
      aliases: [...new Set(rows.flatMap((r) => r.aliases))],
      position: keeper.position ?? firstOf((r) => r.position),
      currentTeamId: keeper.currentTeamId ?? firstOf((r) => r.currentTeamId),
      isActive: rows.some((r) => r.isActive),
      prominence: statsRow.prominence,
      pointsPerGame: statsRow.pointsPerGame ?? keeper.pointsPerGame,
      statsSyncedAt: statsRow.statsSyncedAt ?? keeper.statsSyncedAt,
      headshotUrl: keeper.headshotUrl ?? firstOf((r) => r.headshotUrl),
    };

    const changed = Object.entries(merged).filter(([k, v]) => {
      const before = keeper[k as keyof PlayerRow];
      return Array.isArray(v) || v instanceof Date
        ? JSON.stringify(v) !== JSON.stringify(before)
        : v !== before;
    });
    for (const [k, v] of changed) {
      const before = JSON.stringify(keeper[k as keyof PlayerRow]);
      console.log(`     ${k}: ${before} → ${JSON.stringify(v)}`);
    }

    for (const loser of losers) {
      /*
       * A post can tag both halves of the split — the extraction named one and
       * a backfill the other — and (rumor_id, player_id) is the primary key,
       * so those rows fold together instead of being repointed. The keeper's
       * row wins on flags and takes the loser's where it has none of its own.
       */
      const keeperTags = await db
        .select()
        .from(rumorPlayers)
        .where(eq(rumorPlayers.playerId, keeper.id));
      const byRumor = new Map(keeperTags.map((t) => [t.rumorId, t]));
      const loserTags = await db
        .select()
        .from(rumorPlayers)
        .where(eq(rumorPlayers.playerId, loser.id));

      for (const tag of loserTags) {
        const existing = byRumor.get(tag.rumorId);
        if (existing) {
          summary.rumorsFolded++;
          console.log(`     rumor #${tag.rumorId}: keeper already tagged, folding`);
          if (dryRun) continue;
          await db
            .update(rumorPlayers)
            .set({
              isPrimary: existing.isPrimary || tag.isPrimary,
              fromTeamId: existing.fromTeamId ?? tag.fromTeamId,
              toTeamId: existing.toTeamId ?? tag.toTeamId,
            })
            .where(
              and(
                eq(rumorPlayers.rumorId, tag.rumorId),
                eq(rumorPlayers.playerId, keeper.id),
              ),
            );
          await db
            .delete(rumorPlayers)
            .where(
              and(
                eq(rumorPlayers.rumorId, tag.rumorId),
                eq(rumorPlayers.playerId, loser.id),
              ),
            );
        } else {
          summary.rumorsRepointed++;
          console.log(`     rumor #${tag.rumorId}: repointed`);
          if (dryRun) continue;
          await db
            .update(rumorPlayers)
            .set({ playerId: keeper.id })
            .where(
              and(
                eq(rumorPlayers.rumorId, tag.rumorId),
                eq(rumorPlayers.playerId, loser.id),
              ),
            );
        }
      }

      /*
       * Images move as they are, except for the primary flag: one primary per
       * kind, so a photo arriving into a kind the keeper already leads is
       * demoted rather than leaving the page to pick between two at random.
       */
      const keeperPrimaryKinds = new Set(
        (
          await db
            .select({ kind: playerImages.kind, isPrimary: playerImages.isPrimary })
            .from(playerImages)
            .where(eq(playerImages.playerId, keeper.id))
        )
          .filter((i) => i.isPrimary)
          .map((i) => i.kind),
      );
      const loserImages = await db
        .select({
          id: playerImages.id,
          kind: playerImages.kind,
          isPrimary: playerImages.isPrimary,
        })
        .from(playerImages)
        .where(eq(playerImages.playerId, loser.id));

      for (const img of loserImages) {
        const demote = img.isPrimary && keeperPrimaryKinds.has(img.kind);
        summary.imagesRepointed++;
        if (demote) summary.imagesDemoted++;
        console.log(
          `     image #${img.id} (${img.kind}): repointed` +
            (demote ? ", demoted — keeper already leads this kind" : ""),
        );
        if (!dryRun) {
          await db
            .update(playerImages)
            .set({ playerId: keeper.id, isPrimary: demote ? false : img.isPrimary })
            .where(eq(playerImages.id, img.id));
        }
        if (!demote && img.isPrimary) keeperPrimaryKinds.add(img.kind);
      }

      if (!dryRun) {
        /*
         * Keep the URL alive before the row that owned it goes.
         *
         * The loser's slug was a real page, and may be indexed or linked. It
         * now belongs to the keeper, so it redirects there permanently rather
         * than 404ing. Recorded here, at the moment the slug is retired, so a
         * later merge cannot forget to do it.
         *
         * Any redirect already aimed at the loser is re-aimed at the keeper in
         * the same breath — otherwise merging a player who had himself
         * absorbed another would leave a redirect pointing at a deleted row,
         * and the cascade would silently drop it.
         */
        await db
          .update(playerSlugRedirects)
          .set({ playerId: keeper.id })
          .where(eq(playerSlugRedirects.playerId, loser.id));
        await db
          .insert(playerSlugRedirects)
          .values({ fromSlug: loser.slug, playerId: keeper.id })
          .onConflictDoUpdate({
            target: playerSlugRedirects.fromSlug,
            set: { playerId: keeper.id },
          });
        await db.delete(players).where(eq(players.id, loser.id));
      }
      summary.deleted++;
      console.log(
        `     ${dryRun ? "would delete" : "deleted"} player #${loser.id} ${loser.slug}` +
          ` — /player/${loser.slug} now redirects to /player/${keeper.slug}`,
      );
    }

    if (!dryRun && changed.length) {
      await db.update(players).set(merged).where(eq(players.id, keeper.id));
    }
    summary.merged++;
    console.log("");
  }

  const leftRes = await db.execute(sql`
    select count(*)::int as remaining from (
      select 1 from players where nba_player_id is not null
       group by nba_player_id having count(*) > 1) d`);
  const [{ remaining }] = (leftRes.rows ?? leftRes) as { remaining: number }[];

  console.log(
    `${dryRun ? "would merge" : "merged"} ${summary.merged} groups, ` +
      `${dryRun ? "removing" : "removed"} ${summary.deleted} rows\n` +
      `  rumor tags repointed ${summary.rumorsRepointed}, folded into an existing tag ${summary.rumorsFolded}\n` +
      `  images repointed ${summary.imagesRepointed}, demoted to secondary ${summary.imagesDemoted}`,
  );
  if (dryRun) {
    console.log("\ndry run, nothing written");
  } else if (remaining > 0) {
    console.log(`\n${remaining} nba ids are still duplicated — re-run to finish.`);
  } else {
    console.log(
      "\nrun `npm run db:migrate` to add the unique index that keeps it this way.",
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
