import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Extract a post from a live article instead of from its feed teaser, and
 * print the current post beside it.
 *
 * Writes nothing. This is the comparison that decides whether fetching is
 * worth building: how much of the gap between a 121-character Yahoo teaser
 * and a 1,700-character Yahoo article actually reaches the reader.
 *
 *   npm run try:article -- <slug> <article-url>
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const slug = args.find((a) => !a.startsWith("http"));
  const url = args.find((a) => a.startsWith("http"));
  if (!slug || !url) {
    console.error("usage: npm run try:article -- <slug> <article-url>");
    process.exitCode = 1;
    return;
  }

  const { db } = await import("@/db");
  const { sql } = await import("drizzle-orm");
  const { extractRumor } = await import("@/lib/extract");
  const { articleText } = await import("@/lib/article");

  const res = await db.execute(sql`
    select r.slug, r.headline, r.body, f.title, f.raw_summary,
           coalesce(nullif(f.publisher,''), s.name) as outlet
      from rumors r join feed_items f on f.id = r.feed_item_id
      join sources s on s.id = f.source_id
     where r.slug = ${slug} limit 1`);
  const row = ((res.rows ?? res) as Record<string, string>[])[0];
  if (!row) {
    console.error(`no post with slug ${slug}`);
    process.exitCode = 1;
    return;
  }

  const page = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html" },
    signal: AbortSignal.timeout(25000),
  });
  const text = articleText(await page.text());

  console.log(`feed gave us ${(row.raw_summary ?? "").length} chars`);
  console.log(`article gives ${text.length} chars\n`);

  const out = await extractRumor({
    title: row.title,
    rawSummary: text,
    publisher: row.outlet,
    sourceName: row.outlet,
  });

  console.log(`NOW      ${row.headline}`);
  console.log(`         ${row.body}\n`);
  console.log(`FROM ARTICLE  ${out.headline}`);
  console.log(`              ${out.body}`);
  console.log(`\nstatus ${out.status} · reporter ${out.reportedBy ?? "none"}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
