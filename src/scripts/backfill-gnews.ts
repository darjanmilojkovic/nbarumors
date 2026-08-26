import { config } from "dotenv";
config({ path: ".env.local" });
import { eq, sql } from "drizzle-orm";
import { writeFileSync } from "node:fs";

/**
 * Repair the posts that came in through Google News.
 *
 * Two problems, one cause. Their stored URL is a news.google.com interstitial,
 * so "Read the full story" sends readers to Google rather than the outlet. And
 * their feed text is the headline repeated, so the summaries had nothing in
 * them — which is what started all of this.
 *
 * Both are fixed by resolving the link to the publisher's own URL. The link is
 * stored everywhere it appears (the post, the feed item, the source row), and
 * where the publisher's page can then be read, the body is rewritten from the
 * article. ESPN cannot be read — it answers a bot challenge — so those posts
 * get the corrected link and keep their text.
 *
 *   npm run backfill:gnews -- --dry --limit 5
 *   npm run backfill:gnews
 */
function reject(body: string, old: string): string | null {
  if (!body || body.length < 40) return "too short";
  if (body === old) return "unchanged";
  if (body.length < old.length * 0.7) return "shorter than what it replaces";
  if (/—/.test(body)) return "em dash";
  if (/\brelay(s|ed)?\b/i.test(body)) return "uses relay";
  if (/[\u0000-\u0008\u000B-\u001F]/.test(body)) return "control characters";
  if (/","\w+":|":\s*(null|")|\\u[0-9a-f]{4}|[{}]/i.test(body)) return "raw JSON in the text";
  if (/(treat (it|this) as|projection rather than reporting|not a deal in motion|speculation (built on|until|rather than)|no reporter is credited)/i.test(body)) {
    return "comments on the sourcing";
  }
  const words = body.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length && new Set(words).size / words.length < 0.5) return "repetitive";
  return null;
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  const li = process.argv.indexOf("--limit");
  const limit = li > -1 ? Number(process.argv[li + 1]) : null;

  const { db } = await import("@/db");
  const { rumors, feedItems, rumorSources } = await import("@/db/schema");
  const { resolveGoogleNewsUrl, fetchArticle } = await import("@/lib/article");
  const { extractRumor } = await import("@/lib/extract");

  const res = await db.execute(sql`
    select r.id, r.slug, r.body, r.reported_by, r.source_url,
           f.id as feed_item_id, f.title, coalesce(f.raw_summary,'') as raw_summary,
           coalesce(nullif(f.publisher,''), s.name) as outlet
      from rumors r join feed_items f on f.id = r.feed_item_id
      join sources s on s.id = f.source_id
     where r.is_published and f.url like '%news.google.com%'
     order by r.published_at desc`);
  const rows = ((res.rows ?? res) as Record<string, string>[]).slice(0, limit ?? 10_000);
  console.log(`${rows.length} posts stored behind a Google News link\n`);

  if (!dryRun && rows.length) {
    const file = `gnews-backfill-${Date.now()}.json`;
    writeFileSync(
      file,
      JSON.stringify(
        rows.map((r) => ({ id: r.id, slug: r.slug, body: r.body, sourceUrl: r.source_url })),
        null,
        2,
      ),
    );
    console.log(`old values saved to ${file}\n`);
  }

  let relinked = 0;
  let rewritten = 0;
  const skipped: string[] = [];

  for (const r of rows) {
    const real = await resolveGoogleNewsUrl(r.source_url);
    if (!real) {
      skipped.push(`${r.slug}: could not resolve`);
      continue;
    }
    relinked++;
    console.log(`— ${r.slug}`);
    console.log(`  link: ${new URL(real).hostname}${new URL(real).pathname.slice(0, 50)}`);

    if (!dryRun) {
      // The link is stored in three places; a reader can reach any of them.
      await db.update(rumors).set({ sourceUrl: real }).where(eq(rumors.id, Number(r.id)));
      await db.update(feedItems).set({ url: real }).where(eq(feedItems.id, Number(r.feed_item_id)));
      await db
        .update(rumorSources)
        .set({ sourceUrl: real })
        .where(eq(rumorSources.feedItemId, Number(r.feed_item_id)));
    }

    const got = await fetchArticle(real);
    if (!got.ok) {
      console.log(`  text: ${got.reason} — keeping the existing summary\n`);
      continue;
    }

    const out = await extractRumor({
      title: r.title,
      rawSummary: r.raw_summary ? `${r.raw_summary}\n\n${got.text}` : got.text,
      publisher: r.outlet,
      sourceName: r.outlet,
    });

    const bad = reject(out.body, r.body);
    if (bad) {
      console.log(`  text: rejected (${bad})\n`);
      continue;
    }

    rewritten++;
    console.log(`  OLD: ${r.body}`);
    console.log(`  NEW: ${out.body}`);
    if (!r.reported_by && out.reportedBy) console.log(`  byline: ${out.reportedBy}`);
    console.log();

    if (!dryRun) {
      await db
        .update(rumors)
        .set({
          body: out.body,
          ...(!r.reported_by && out.reportedBy ? { reportedBy: out.reportedBy } : {}),
        })
        .where(eq(rumors.id, Number(r.id)));
    }
  }

  console.log(
    `${dryRun ? "would relink" : "relinked"} ${relinked} of ${rows.length} · ${dryRun ? "would rewrite" : "rewrote"} ${rewritten}`,
  );
  if (skipped.length) {
    console.log(`\nleft alone (${skipped.length}):`);
    for (const s of skipped) console.log(`  ${s}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
