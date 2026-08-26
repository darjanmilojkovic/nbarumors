import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { feedItems, rumors, sources } from "@/db/schema";
import { FETCH_ARTICLE_SOURCES, bestText } from "@/lib/article";
import { extractRumor, extractionModel } from "@/lib/extract";
import { pendingItems, publishExtraction } from "@/lib/publish";

export type ProcessResult = {
  model: string;
  examined: number;
  published: number;
  merged: number;
  held: number;
  rejected: number;
  errors: number;
  /** Items whose article was fetched because the feed only gave a teaser. */
  fetched: number;
  fetchFailures: string[];
  durationMs: number;
};

/** Run at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (i: T) => Promise<void>) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) await fn(items[cursor++]);
    }),
  );
}

/**
 * Extract structured rumors from unprocessed feed items.
 *
 * Concurrency is deliberately modest: each item is one API call, and the
 * shared system prompt caches, so running a few at a time keeps the cache warm
 * without tripping rate limits.
 */
export async function runExtraction(limit = 50): Promise<ProcessResult> {
  const started = Date.now();
  const items = await pendingItems(limit);

  const sourceRows = await db
    .select({ id: sources.id, name: sources.name, slug: sources.slug })
    .from(sources);
  const sourceName = new Map(sourceRows.map((s) => [s.id, s.name]));
  // A log entry and a news report get treated differently on merge.
  const sourceSlug = new Map(sourceRows.map((s) => [s.id, s.slug]));

  /*
   * The headlines a reader will see beside whatever this run produces: the
   * most recent published, plus the ones written as the run goes. Extraction
   * is per-item, so without this each new post is written blind to the ones
   * either side of it and they converge on one construction.
   */
  const recent = await db
    .select({ headline: rumors.headline })
    .from(rumors)
    .where(eq(rumors.isPublished, true))
    .orderBy(desc(rumors.publishedAt))
    .limit(8);
  const recentHeadlines = recent.map((r) => r.headline);

  let published = 0;
  let merged = 0;
  let held = 0;
  let rejected = 0;
  let errors = 0;
  let fetched = 0;
  const fetchFailures: string[] = [];

  await pool(items, 4, async (item) => {
    try {
      /*
       * Read the article rather than the teaser, where the outlet's feed only
       * carries one. Never fatal: a fetch that fails returns the teaser, so a
       * paywall or a timeout costs detail, not the item.
       */
      const source = await bestText({
        url: item.url,
        rawSummary: item.rawSummary,
        sourceSlug: sourceSlug.get(item.sourceId) ?? "",
      });
      if (source.fetched) fetched++;
      else if (FETCH_ARTICLE_SOURCES.has(sourceSlug.get(item.sourceId) ?? "")) {
        fetchFailures.push(`${item.url.slice(0, 60)}: ${source.reason}`);
      }

      const extraction = await extractRumor({
        title: item.title,
        rawSummary: source.text,
        recentHeadlines,
        publisher: item.publisher,
        sourceName: sourceName.get(item.sourceId) ?? "unknown",
      });
      const result = await publishExtraction(
        { ...item, sourceSlug: sourceSlug.get(item.sourceId) ?? "" },
        extraction,
      );
      /*
       * Written this run, so the next item in the same batch sees it too. A
       * quiet night can publish six posts in one pass, and without this they
       * would all be written against the same eight older headlines and could
       * still converge on each other.
       */
      if (result.status === "published" || result.status === "held") {
        recentHeadlines.unshift(extraction.headline);
        recentHeadlines.splice(8);
      }

      if (result.status === "published") published++;
      else if (result.status === "merged") merged++;
      else if (result.status === "held") held++;
      else rejected++;
    } catch (err) {
      errors++;
      // Leave processedAt null so a later run retries, but record why.
      await db
        .update(feedItems)
        .set({
          rejectedReason: `extraction error: ${
            err instanceof Error ? err.message : String(err)
          }`.slice(0, 500),
        })
        .where(eq(feedItems.id, item.id));
    }
  });

  return {
    model: extractionModel(),
    examined: items.length,
    published,
    merged,
    held,
    rejected,
    errors,
    fetched,
    fetchFailures,
    durationMs: Date.now() - started,
  };
}
