import { eq } from "drizzle-orm";
import { db } from "@/db";
import { feedItems, sources } from "@/db/schema";
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
    .select({ id: sources.id, name: sources.name })
    .from(sources);
  const sourceName = new Map(sourceRows.map((s) => [s.id, s.name]));

  let published = 0;
  let merged = 0;
  let held = 0;
  let rejected = 0;
  let errors = 0;

  await pool(items, 4, async (item) => {
    try {
      const extraction = await extractRumor({
        title: item.title,
        rawSummary: item.rawSummary,
        publisher: item.publisher,
        sourceName: sourceName.get(item.sourceId) ?? "unknown",
      });
      const result = await publishExtraction(item, extraction);
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
    durationMs: Date.now() - started,
  };
}
