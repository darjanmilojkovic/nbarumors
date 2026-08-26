import { config } from "dotenv";
config({ path: ".env.local" });
import { eq, sql } from "drizzle-orm";
import { writeFileSync } from "node:fs";

/**
 * Re-extract existing posts from their articles instead of their teasers.
 *
 * Fetching runs inside the extraction pipeline, so it only ever helps items
 * arriving from now on. Everything already published was written from whatever
 * the feed carried at the time — 126 characters on average for Yahoo — and
 * stayed that way. "Kuminga said to favor Lakers over Timberwolves" read as
 * one thin sentence for exactly this reason, after the fetch was proven to
 * turn it into four.
 *
 * Rewrites the BODY, and fills reportedBy where it was empty, because the
 * article usually names the reporter the teaser omits. Deliberately does NOT
 * touch status, headline, slug, players, teams or dates: status drives the
 * badge and the ranking, and a backfill is not the place to move those.
 *
 * Old values are written to JSON before anything is updated.
 *
 *   npm run backfill:articles -- --dry --limit 3
 *   npm run backfill:articles
 */
function reject(body: string, old: string): string | null {
  if (!body || body.length < 40) return "too short";
  if (body === old) return "unchanged";
  /*
   * Reading the whole article should not produce LESS than reading the
   * teaser. When it does, the fetch found a rail or a listicle rather than a
   * story: the Miles McBride extension piece came back as "A column on Miles
   * McBride's extension eligibility", against three informative sentences
   * written from the feed.
   */
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
  const { rumors } = await import("@/db/schema");
  const { fetchArticle, FETCH_ARTICLE_SOURCES, THIN_SUMMARY_CHARS } = await import("@/lib/article");
  const { extractRumor } = await import("@/lib/extract");

  const slugs = [...FETCH_ARTICLE_SOURCES];
  const res = await db.execute(sql`
    select r.id, r.slug, r.headline, r.body, r.reported_by, r.status,
           f.title, f.url, coalesce(f.raw_summary,'') as raw_summary,
           coalesce(nullif(f.publisher,''), s.name) as outlet
      from rumors r join feed_items f on f.id = r.feed_item_id
      join sources s on s.id = f.source_id
     where r.is_published and s.slug in ${slugs}
       and length(coalesce(f.raw_summary,'')) < ${THIN_SUMMARY_CHARS}
     order by r.published_at desc`);

  const rows = ((res.rows ?? res) as Record<string, string>[]).slice(0, limit ?? 10_000);
  console.log(`${rows.length} posts written from a teaser\n`);

  if (!dryRun && rows.length) {
    const file = `article-backfill-${Date.now()}.json`;
    writeFileSync(
      file,
      JSON.stringify(
        rows.map((r) => ({ id: r.id, slug: r.slug, body: r.body, reportedBy: r.reported_by })),
        null,
        2,
      ),
    );
    console.log(`old values saved to ${file}\n`);
  }

  let changed = 0;
  const skipped: string[] = [];

  for (const r of rows) {
    const got = await fetchArticle(r.url);
    if (!got.ok) {
      skipped.push(`${r.slug}: ${got.reason}`);
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
      skipped.push(`${r.slug}: ${bad}`);
      continue;
    }

    changed++;
    console.log(`— ${r.slug}`);
    console.log(`  feed ${r.raw_summary.length} chars → article ${got.text.length} chars`);
    console.log(`  OLD: ${r.body}`);
    console.log(`  NEW: ${out.body}`);
    if (!r.reported_by && out.reportedBy) console.log(`  byline: ${out.reportedBy}`);
    if (out.status !== r.status) console.log(`  (status would be ${out.status}, left as ${r.status})`);
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

  console.log(`${dryRun ? "would rewrite" : "rewrote"} ${changed} of ${rows.length}`);
  if (skipped.length) {
    console.log(`\nleft alone (${skipped.length}):`);
    for (const s of skipped) console.log(`  ${s}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
