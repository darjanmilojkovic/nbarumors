import { config } from "dotenv";
config({ path: ".env.local" });
import { sql } from "drizzle-orm";

/**
 * Show what a post's summary would become if a later report were folded into
 * it. Writes nothing.
 *
 * The pipeline does this on its own now, but only for reports that actually
 * match. This runs the same function over any two posts by slug, which is how
 * to judge a candidate merge before loosening what counts as a match.
 *
 *   npm run try:enrich -- <post-slug> <later-post-slug> [<later-post-slug>...]
 */
async function main() {
  const slugs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (slugs.length < 2) {
    console.error("usage: npm run try:enrich -- <slug> <later-slug> [...]");
    process.exitCode = 1;
    return;
  }

  const { db } = await import("@/db");
  const { enrichBody, addsSomething } = await import("@/lib/enrich");
  const res = await db.execute(sql`
    select r.slug, r.headline, r.body, r.status, r.contract_value, r.contract_years,
           coalesce(nullif(f.publisher,''), s.name) as outlet
      from rumors r join feed_items f on f.id = r.feed_item_id
      join sources s on s.id = f.source_id
     where r.slug in ${slugs}`);
  const bySlug = new Map(
    ((res.rows ?? res) as Record<string, string>[]).map((r) => [r.slug, r]),
  );

  const first = bySlug.get(slugs[0]);
  if (!first) {
    console.error(`no post with slug ${slugs[0]}`);
    process.exitCode = 1;
    return;
  }

  let body = String(first.body);
  console.log(`START  ${first.slug}  [${first.outlet}]`);
  console.log(`       ${body}\n`);

  for (const slug of slugs.slice(1)) {
    const next = bySlug.get(slug);
    if (!next) {
      console.log(`  (no post with slug ${slug})`);
      continue;
    }
    console.log(`+ ${slug}  [${next.outlet}]`);
    console.log(`  ${next.body}`);

    if (!addsSomething(body, String(next.body))) {
      console.log(`  → adds nothing the summary does not already say\n`);
      continue;
    }

    const grown = await enrichBody({
      headline: String(first.headline),
      current: body,
      // Only the fields enrichBody reads; the rest of an Extraction is unused.
      incoming: {
        body: String(next.body),
        contractValue: (next.contract_value as string) ?? null,
        contractYears: next.contract_years ? Number(next.contract_years) : null,
      } as Parameters<typeof enrichBody>[0]["incoming"],
      incomingOutlet: String(next.outlet),
    });

    if (!grown) {
      console.log(`  → rejected, summary left as it was\n`);
      continue;
    }
    body = grown;
    console.log(`  → ${body}\n`);
  }

  console.log(`RESULT (${body.length} chars)\n${body}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
