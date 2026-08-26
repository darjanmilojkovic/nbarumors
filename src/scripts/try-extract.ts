import { config } from "dotenv";
config({ path: ".env.local" });
import { sql } from "drizzle-orm";

/**
 * Re-run extraction on published items WITHOUT writing anything, so a prompt
 * change can be judged against posts we already dislike before it reaches the
 * database.
 *
 *   npm run try:extract -- <slug> [<slug> ...]
 */
async function main() {
  const slugs = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const { db } = await import("@/db");
  const { extractRumor } = await import("@/lib/extract");

  const res = await db.execute(sql`
    select r.slug, r.body as old_body, f.title, f.raw_summary, f.publisher,
           s.name as source_name
      from rumors r join feed_items f on f.id = r.feed_item_id
      join sources s on s.id = f.source_id
     where r.slug in ${slugs}`);

  for (const row of (res.rows ?? res) as Record<string, string>[]) {
    const out = await extractRumor({
      title: row.title,
      rawSummary: row.raw_summary,
      publisher: row.publisher,
      sourceName: row.source_name,
    });
    console.log("=".repeat(72));
    console.log("INPUT  ", row.title);
    console.log("BEFORE ", row.old_body);
    console.log("AFTER  ", out.body);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
