import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { feedItems, rumors, sources } from "@/db/schema";
import { FETCH_ARTICLE_SOURCES, bestText } from "@/lib/article";
import { extractRumor, modelFor } from "@/lib/extract";
import { GATE_REASON, worthExtracting } from "@/lib/gate";
import { pendingItems, publishExtraction } from "@/lib/publish";

export type ProcessResult = {
  byModel: Record<string, number>;
  examined: number;
  published: number;
  merged: number;
  held: number;
  rejected: number;
  /** Screened out before extraction, so never sent to the expensive model. */
  gated: number;
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
  let gated = 0;
  let errors = 0;
  let fetched = 0;
  const fetchFailures: string[] = [];
  /*
   * How the run split across models. Worth reporting: the split is the whole
   * cost story now, and it moves on its own as the fetchers succeed or fail —
   * a night where the article fetches all time out sends everything to the
   * cheap model, which looks like a saving and is really a loss of detail.
   */
  const byModel = new Map<string, number>();

  const handle = async (item: (typeof items)[number]) => {
    try {
      /*
       * Screen before the article fetch, not just before extraction. An MLB
       * broadcast listing should cost neither an Opus call nor a page load.
       *
       * The teaser is all this sees, which is the point — it is the same
       * headline and 200 characters the evaluation scored, where it blocked
       * 81% of what extraction went on to reject and passed 99% of what it
       * kept. Recorded with its own reason rather than dropped, so the 1% it
       * turns away wrongly can be found later instead of vanishing.
       */
      if (!(await worthExtracting(item))) {
        gated++;
        await db
          .update(feedItems)
          .set({ processedAt: new Date(), rejectedReason: GATE_REASON })
          .where(eq(feedItems.id, item.id));
        return;
      }

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

      const model = modelFor();
      byModel.set(model, (byModel.get(model) ?? 0) + 1);

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
  };

  /*
   * One item first, alone, then the rest four at a time.
   *
   * The four workers used to start together on a cold cache, so all four
   * missed and all four WROTE the same ~6,400-token prefix at 1.25x. Priming
   * it with a single call means the other three read it at 0.1x instead. With
   * a median batch of five, that was three redundant writes in every run.
   */
  const [first, ...rest] = items;
  if (first) await handle(first);
  await pool(rest, 4, handle);

  return {
    byModel: Object.fromEntries(byModel),
    gated,
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
