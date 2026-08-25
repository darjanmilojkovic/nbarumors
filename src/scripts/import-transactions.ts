import { config } from "dotenv";
config({ path: ".env.local" });
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";

/**
 * Import Basketball-Reference's season transaction log as feed items, so the
 * normal extraction pass turns them into posts.
 *
 * Routing them through the pipeline rather than writing rumors directly is
 * deliberate: extraction assigns an event key, which lets a completed
 * transaction MERGE with the rumor that preceded it instead of duplicating
 * it. That is what turns "reported" into "done deal" on an existing post.
 *
 * `npm run import:transactions -- --dry` to preview.
 */

/** Roster paperwork rather than player movement — excluded by default. */
const isPaperwork = (text: string) =>
  /\bwaived\b|\btwo-way\b|\bconverted\b|\bexhibit\b|\bsummer league\b/i.test(text);

async function main() {
  const dryRun = process.argv.includes("--dry");
  const all = process.argv.includes("--all");

  const { db } = await import("@/db");
  const { feedItems, sources } = await import("@/db/schema");
  const { fetchTransactions } = await import("@/lib/transactions");

  const tx = await fetchTransactions(2026);
  const kept = all ? tx : tx.filter((t) => !isPaperwork(t.text));
  console.log(
    `parsed ${tx.length} transactions · importing ${kept.length}` +
      `${all ? " (all)" : " (trades and signings; paperwork skipped)"}`,
  );

  // Register the archive as a source so posts carry a sensible byline.
  const [source] = await db
    .insert(sources)
    .values({
      slug: "bbref-transactions",
      name: "Basketball-Reference",
      homepageUrl: "https://www.basketball-reference.com/",
      feedUrl:
        "https://www.basketball-reference.com/leagues/NBA_2026_transactions.html",
      kind: "archive",
      // Not a feed — imported on demand, never polled by cron.
      enabled: false,
    })
    .onConflictDoUpdate({
      target: sources.slug,
      set: { name: sql`excluded.name` },
    })
    .returning({ id: sources.id });

  const sourceId =
    source?.id ??
    (
      await db
        .select({ id: sources.id })
        .from(sources)
        .where(eq(sources.slug, "bbref-transactions"))
        .limit(1)
    )[0].id;

  if (dryRun) {
    console.log("\nsample of what would be imported:");
    for (const t of kept.slice(0, 8)) {
      console.log(`  ${t.date.toISOString().slice(0, 10)}  ${t.text.slice(0, 92)}`);
    }
    const est = (kept.length * 0.0082).toFixed(2);
    console.log(`\nestimated extraction cost: ~$${est}`);
    return;
  }

  let inserted = 0;
  for (const t of kept) {
    // Synthetic per-transaction URL; the hash is what the dedupe index sees,
    // so re-running the import can never double-insert.
    const fingerprint = createHash("sha256")
      .update(`bbref|${t.date.toISOString().slice(0, 10)}|${t.text}`)
      .digest("hex");
    const url = `https://www.basketball-reference.com/leagues/NBA_2026_transactions.html#${fingerprint.slice(0, 16)}`;

    const rows = await db
      .insert(feedItems)
      .values({
        sourceId,
        urlHash: fingerprint,
        url,
        title: t.text.slice(0, 400),
        rawSummary:
          `Official transaction record. Teams: ${t.teamAbbrevs.join(", ") || "not tagged"}. ` +
          `Players: ${t.playerNames.join(", ") || "none"}.`,
        publisher: "Basketball-Reference",
        publishedAt: t.date,
      })
      .onConflictDoNothing({ target: feedItems.urlHash })
      .returning({ id: feedItems.id });
    if (rows.length > 0) inserted++;
  }

  const [pending] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(feedItems)
    .where(sql`${feedItems.processedAt} is null`);

  console.log(`\ninserted ${inserted} new feed items (${kept.length - inserted} already present)`);
  console.log(`unprocessed queue is now ${pending.n}`);
  console.log(`\nnext: npm run extract -- ${Math.max(pending.n, 1)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
