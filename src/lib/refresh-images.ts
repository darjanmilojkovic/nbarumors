import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { playerImages, players, rumors } from "@/db/schema";
import { findCommonsImages, preferLandscape } from "@/lib/images";
import { isUsableShareImage } from "@/lib/share-image";

/**
 * Re-resolve the player pictures that are missing or wrong.
 *
 * Two things go stale on their own and nothing was fixing either.
 *
 * A player written about once in June, whose Commons search came back empty
 * then, is never retried: `ensurePlayerImage` only runs at publish time and
 * only when the player has no image at all, so the dormant tail never gets a
 * second look. 54 players are in that state.
 *
 * And a third of the library — 137 of 428 — is not a photograph of the player
 * it is filed under, because the Commons search matches a full-text name and a
 * surname alone pulls in nursery catalogues, county maps and, in one case, a
 * 1663 almanac. Those are blocked from share cards by the guard in
 * lib/share-image, but blocking is not fixing: the player is left on a
 * headshot when a real photograph may well exist.
 *
 * This walks both sets. It does NOT touch players whose picture already
 * passes: re-rolling a good image every month risks trading it for a worse
 * one, and the API already asks for 1200px thumbnails so there is no quality
 * tail to chase.
 *
 * What it deliberately does not solve: a photo going out of date because the
 * player changed clubs — LeBron in a Lakers jersey after signing in
 * Philadelphia. Commons filenames rarely name the team, so there is no
 * reliable signal to act on, and guessing would churn good pictures for bad.
 */

/**
 * How many players to attempt per run.
 *
 * Measured rather than guessed: a dry run of 40 took 30.5s, so about 0.76s
 * each, and writes add to that. 150 lands near 165s against the route's 300s
 * cap, which leaves room for a slow day at Wikimedia.
 *
 * The standing backlog is about 191, so the first two monthly runs clear it —
 * or one manual call with `?limit=`. After that a month's worth is a handful.
 */
const PER_RUN = 150;

export type RefreshResult = {
  considered: number;
  fixed: number;
  stillNothing: number;
  reattached: number;
  errors: number;
};

export async function refreshPlayerImages(
  { limit = PER_RUN, dryRun = false }: { limit?: number; dryRun?: boolean } = {},
): Promise<RefreshResult> {
  const result: RefreshResult = {
    considered: 0,
    fixed: 0,
    stillNothing: 0,
    reattached: 0,
    errors: 0,
  };

  /*
   * Only players the site actually shows: one published post or more. The
   * directory lists everyone on a roster, but a page nobody has written about
   * is noindexed and absent from the sitemap, so a picture for it buys nothing.
   */
  const candidates = await db
    .select({
      id: players.id,
      fullName: players.fullName,
    })
    .from(players)
    .where(
      sql`exists (
        select 1 from rumor_players rp
          join rumors r on r.id = rp.rumor_id and r.is_published
         where rp.player_id = ${players.id}
      )`,
    );

  const existing = await db
    .select({
      id: playerImages.id,
      playerId: playerImages.playerId,
      url: playerImages.url,
      width: playerImages.width,
      height: playerImages.height,
    })
    .from(playerImages);

  const byPlayer = new Map<number, typeof existing>();
  for (const img of existing) {
    byPlayer.set(img.playerId, [...(byPlayer.get(img.playerId) ?? []), img]);
  }

  /* Missing entirely, or holding nothing that survives the guard. */
  const needy = candidates.filter((p) => {
    const mine = byPlayer.get(p.id) ?? [];
    return !mine.some((i) =>
      isUsableShareImage(i.url, p.fullName, i.width, i.height),
    );
  });

  for (const player of needy.slice(0, limit)) {
    result.considered++;

    let best;
    try {
      const candidates = await findCommonsImages(player.fullName);
      best = candidates
        .filter((c) =>
          isUsableShareImage(c.url, player.fullName, c.width, c.height),
        )
        .sort(preferLandscape)[0];
    } catch {
      result.errors++;
      continue;
    }

    if (!best) {
      result.stillNothing++;
      continue;
    }

    /*
     * A dry run still performs the search — that is the part worth proving,
     * since it is the only step that leaves the building — and stops before
     * anything is written.
     */
    if (dryRun) {
      result.fixed++;
      continue;
    }

    /*
     * The junk goes before the replacement lands. `rumors.image_id` is ON
     * DELETE SET NULL, so any post pointing at a nursery catalogue simply
     * loses its picture rather than blocking the delete — and is re-pointed
     * at the new one below.
     */
    const stale = (byPlayer.get(player.id) ?? []).map((i) => i.id);
    let orphaned: number[] = [];
    if (stale.length) {
      orphaned = (
        await db
          .select({ id: rumors.id })
          .from(rumors)
          .where(inArray(rumors.imageId, stale))
      ).map((r) => r.id);
      await db.delete(playerImages).where(inArray(playerImages.id, stale));
    }

    const [created] = await db
      .insert(playerImages)
      .values({
        playerId: player.id,
        kind: "action",
        url: best.url,
        width: best.width,
        height: best.height,
        license: best.license,
        attribution: best.attribution,
        attributionUrl: best.attributionUrl,
        sourceUrl: best.sourceUrl,
        isPrimary: true,
      })
      .onConflictDoNothing({ target: playerImages.url })
      .returning({ id: playerImages.id });

    if (!created) {
      result.stillNothing++;
      continue;
    }
    result.fixed++;

    /* Give the posts their picture back, now that it is a real one. */
    if (orphaned.length) {
      await db
        .update(rumors)
        .set({ imageId: created.id })
        .where(inArray(rumors.id, orphaned));
      result.reattached += orphaned.length;
    }
  }

  void eq;
  return result;
}
