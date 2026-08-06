import { eq } from "drizzle-orm";
import { db } from "@/db";
import { feedItems, sources, type Source } from "@/db/schema";
import { fetchFeed, type ParsedItem } from "@/lib/feeds";
import {
  canonicalizeUrl,
  displayDomain,
  isAggregatorUrl,
  resolveUrl,
  splitAggregatorTitle,
  urlHash,
} from "@/lib/urls";

export type SourceResult = {
  source: string;
  fetched: number;
  inserted: number;
  duplicates: number;
  error?: string;
};

export type IngestResult = {
  startedAt: string;
  durationMs: number;
  sources: SourceResult[];
  totalInserted: number;
};

/** Run `tasks` with at most `limit` in flight. */
async function pool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

const truncate = (s: string | null, max: number) =>
  s == null ? null : s.length > max ? s.slice(0, max) : s;

/**
 * Ignore items far in the past on first run so a backfill doesn't publish
 * two-year-old "rumors" as news.
 */
const MAX_AGE_DAYS = 14;

async function ingestSource(source: Source): Promise<SourceResult> {
  let items: ParsedItem[];
  try {
    items = await fetchFeed(source.feedUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(sources)
      .set({ lastFetchedAt: new Date(), lastError: message })
      .where(eq(sources.id, source.id));
    return { source: source.slug, fetched: 0, inserted: 0, duplicates: 0, error: message };
  }

  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 86_400_000);
  const fresh = items.filter((i) => i.publishedAt >= cutoff);

  // Google News links are redirectors; resolving them is what makes the same
  // story from three feeds collapse into one row.
  const rows = await pool(fresh, 5, async (item) => {
    const resolved = await resolveUrl(item.link);
    const canonical = canonicalizeUrl(resolved);

    // Google serves an interstitial rather than a 30x, so aggregator links
    // often survive resolution. Recover the outlet from the title instead.
    const stillAggregated = isAggregatorUrl(canonical);
    const { title, publisher } = stillAggregated
      ? splitAggregatorTitle(item.title)
      : { title: item.title, publisher: displayDomain(canonical) };

    return {
      sourceId: source.id,
      urlHash: urlHash(canonical),
      url: canonical,
      title,
      rawSummary: item.summary,
      author: truncate(item.author, 128),
      publisher: truncate(publisher, 96),
      publishedAt: item.publishedAt,
    };
  });

  // Same story can appear twice within one feed; dedupe before the insert so
  // Postgres doesn't reject the whole batch on a self-conflict.
  const seen = new Set<string>();
  const unique = rows.filter((r) =>
    seen.has(r.urlHash) ? false : (seen.add(r.urlHash), true),
  );

  let inserted = 0;
  if (unique.length > 0) {
    const written = await db
      .insert(feedItems)
      .values(unique)
      .onConflictDoNothing({ target: feedItems.urlHash })
      .returning({ id: feedItems.id });
    inserted = written.length;
  }

  const newest = fresh.reduce<Date | null>(
    (max, i) => (max === null || i.publishedAt > max ? i.publishedAt : max),
    null,
  );
  await db
    .update(sources)
    .set({ lastFetchedAt: new Date(), lastItemAt: newest, lastError: null })
    .where(eq(sources.id, source.id));

  return {
    source: source.slug,
    fetched: items.length,
    inserted,
    duplicates: unique.length - inserted,
  };
}

/** Fetch every enabled source and write new items to `feed_items`. */
export async function runIngest(): Promise<IngestResult> {
  const started = Date.now();
  const enabled = await db.select().from(sources).where(eq(sources.enabled, true));

  const results = await pool(enabled, 4, ingestSource);

  return {
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    sources: results,
    totalInserted: results.reduce((n, r) => n + r.inserted, 0),
  };
}
