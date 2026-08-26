import { config } from "dotenv";
config({ path: ".env.local" });
import { eq } from "drizzle-orm";

/**
 * Merge one named post into another.
 *
 * merge:events finds duplicates by comparing event keys, which works when two
 * outlets describe a move in similar words. It does not catch a pair like
 * "joel-embiid-phi-was-trade-speculation" and
 * "embiid-davis-phi-was-hypothetical-swap" — the same heavy.com article
 * ingested twice, once through Google News with only its headline and once
 * through the outlet's own feed with the whole thing. The keys share four
 * tokens out of nine and score below any threshold safe to run in bulk.
 *
 * So: name them by hand. The duplicate is unpublished rather than deleted, and
 * its feed item is attached to the keeper as a source row, which is what makes
 * the old URL 301 to the new post instead of 404ing.
 *
 *   npm run merge:pair -- <keeper-slug> <duplicate-slug> [--dry]
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const [keeperSlug, dupeSlug] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!keeperSlug || !dupeSlug) {
    console.error("usage: npm run merge:pair -- <keeper-slug> <duplicate-slug> [--dry]");
    process.exitCode = 1;
    return;
  }

  const { db } = await import("@/db");
  const { rumors, rumorSources } = await import("@/db/schema");

  const load = async (slug: string) => {
    const [r] = await db
      .select({
        id: rumors.id,
        slug: rumors.slug,
        headline: rumors.headline,
        body: rumors.body,
        feedItemId: rumors.feedItemId,
        sourceId: rumors.sourceId,
        sourceUrl: rumors.sourceUrl,
        reportedBy: rumors.reportedBy,
        publishedAt: rumors.publishedAt,
        isPublished: rumors.isPublished,
      })
      .from(rumors)
      .where(eq(rumors.slug, slug))
      .limit(1);
    return r ?? null;
  };

  const keeper = await load(keeperSlug);
  const dupe = await load(dupeSlug);
  if (!keeper || !dupe) {
    console.error(`not found: ${!keeper ? keeperSlug : dupeSlug}`);
    process.exitCode = 1;
    return;
  }

  console.log(`KEEP  ${keeper.slug}\n      ${keeper.body}\n`);
  console.log(`DROP  ${dupe.slug}\n      ${dupe.body}\n`);

  if (dryRun) return console.log("dry run, nothing written");

  /*
   * The duplicate's own feed item already has a rumor_sources row, pointing at
   * the duplicate, and the table holds one row per feed item. So reassign that
   * row to the keeper rather than inserting a second one — which is also what
   * makes the redirect resolve, since it finds the keeper by feed item.
   */
  if (dupe.feedItemId) {
    await db
      .update(rumorSources)
      .set({ rumorId: keeper.id })
      .where(eq(rumorSources.feedItemId, dupe.feedItemId));
  }

  await db.update(rumors).set({ isPublished: false }).where(eq(rumors.id, dupe.id));
  console.log(`merged. /rumor/${dupe.slug} now redirects to /rumor/${keeper.slug}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
