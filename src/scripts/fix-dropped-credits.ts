import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync } from "node:fs";

/**
 * Put back a reporter's outlet where the summary dropped the one the source
 * gave: "Shams Charania reported" where the item said "ESPN's Shams
 * Charania reported".
 *
 * `dropsReporterOutlet` now sends these back for a retry at extraction; this
 * reaches the posts extracted before it. No model: the credit is the source's
 * own words, so the first mention of the name is replaced with them. The
 * source is the post's own feed item, read through the article fetch where
 * the feed only carries a teaser, as extraction does.
 *
 *   npm run fix:credits -- [days, default 60] --dry
 *   npm run fix:credits -- [days] --apply
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const days = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 60);

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL!);
  const { dropsReporterOutlet, outletName } = await import("@/lib/extract");
  const { bestText } = await import("@/lib/article");

  const posts = (await sql`
    select r.id, r.slug, r.body, f.url, f.raw_summary, f.publisher, s.slug as source_slug, s.name as source_name
      from rumors r
      join feed_items f on f.id = r.feed_item_id
      join sources s on s.id = f.source_id
     where r.is_published
       and r.reported_by is not null
       and r.created_at > now() - make_interval(days => ${days})
     order by r.created_at desc`) as {
    id: number;
    slug: string;
    body: string;
    url: string;
    raw_summary: string | null;
    publisher: string | null;
    source_slug: string;
    source_name: string;
  }[];
  console.log(`${posts.length} posts naming a reporter in the last ${days} days`);

  const fixes: { id: number; slug: string; body: string; next: string; credit: string }[] = [];
  for (const p of posts) {
    const card = [outletName(p.publisher, p.source_name), p.publisher, p.source_name];
    const source = await bestText({ url: p.url, rawSummary: p.raw_summary, sourceSlug: p.source_slug });
    const found = dropsReporterOutlet(source.text, p.body, card);
    if (!found) continue;
    // The site writes straight apostrophes; sources often send curly ones.
    const credit = found.replace(/’/g, "'");

    // The credit is "ESPN's Shams Charania" or "Shams Charania of ESPN"; find the bare name inside it.
    const nameMatch = credit.match(/([A-Z][a-z]+(?: [A-Z][a-zA-Z'-]+){1,2})$/) ?? credit.match(/^([A-Z][a-z]+(?: [A-Z][a-zA-Z'-]+){1,2})/);
    const name = nameMatch?.[1];
    if (!name || !p.body.includes(name)) continue;
    /*
     * Leave a name that already carries a possessive, either way round. Before
     * it, the summary credited some other outlet and needs a person to judge
     * which is right ("ESPN's John Hollinger" where the source says The
     * Athletic); after it, "ESPN's Shams Charania's July report" is worse
     * than what is there.
     */
    const at = p.body.indexOf(name);
    const before = p.body.slice(Math.max(0, at - 3), at);
    const after = p.body.slice(at + name.length, at + name.length + 2);
    if (/['’]s ?$/.test(before) || /^['’]s/.test(after)) {
      console.log(`#${p.id} left for review: "${p.body.slice(Math.max(0, at - 25), at + name.length + 12)}" vs source "${credit}"`);
      continue;
    }
    const next = p.body.replace(name, credit);
    fixes.push({ id: p.id, slug: p.slug, body: p.body, next, credit });
  }

  for (const f of fixes) {
    const at = f.next.indexOf(f.credit);
    console.log(`#${f.id}  ...${f.next.slice(Math.max(0, at - 40), at + f.credit.length + 30).replace(/\n+/g, " ")}...`);
  }
  console.log(`\n${fixes.length} post(s) ${apply ? "fixed" : "to fix"}`);
  if (!apply || !fixes.length) return;

  const file = `dropped-credits-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(fixes.map((f) => ({ id: String(f.id), slug: f.slug, body: f.body })), null, 2));
  for (const f of fixes) await sql`update rumors set body = ${f.next} where id = ${f.id}`;
  console.log(`old values saved to ${file}; undo one with: npm run restore:body -- ${file} <slug>`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
