import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Grow the settled posts that were frozen as one-line stubs.
 *
 * `attachSource` now enriches a settled post whose body is under 240
 * characters once three or more outlets have covered it, but a rule change
 * only affects reports that arrive AFTER it. The posts already in that state
 * have their whole chain attached and will never see another merge, so nothing
 * would ever reach them.
 *
 * "Josh Green heads to Utah as Williams and Konchar go to Minnesota" is the
 * case: born from ESPN's 103-character wire alert, ten outlets attached over
 * nine hours, and the reason the trade happened — Green's $14.7M coming off
 * the books to clear Minnesota's hard cap for Kuminga — sat in the chain
 * unreachable.
 *
 * The chain's raw feed text is not usable directly. Several members are Yahoo
 * pages that open with a photo caption, and `enrichBody` expects a clean
 * extracted summary rather than page scrapings, so this re-runs the normal
 * extraction on each chain member first and enriches from the results. That is
 * the same path a live merge takes, which is the point: no special-case prose.
 *
 *   npx tsx src/scripts/backfill-stub-bodies.ts --dry
 *   npx tsx src/scripts/backfill-stub-bodies.ts --apply
 */

const STUB_CHARS = 240;
const STUB_OUTLETS = 3;

async function main() {
  const apply = process.argv.includes("--apply");
  /* Limit to one post, so a result can be judged before the rest follow. */
  const slugArg = process.argv.indexOf("--slug");
  const onlySlug = slugArg > -1 ? process.argv[slugArg + 1] : null;

  const { db } = await import("@/db");
  const { rumors } = await import("@/db/schema");
  const { sql, eq } = await import("drizzle-orm");
  const { extractRumor } = await import("@/lib/extract");
  const { enrichBody } = await import("@/lib/enrich");

  const rows = <T,>(r: unknown): T[] =>
    ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as T[];

  const targets = rows<{
    id: number;
    headline: string;
    body: string;
    slug: string;
    n: number;
  }>(
    await db.execute(sql`
      select r.id, r.slug, r.headline, r.body,
             (select count(*)::int from rumor_sources rs where rs.rumor_id = r.id) n
      from rumors r
      where r.is_published
        and r.status in ('completed','confirmed')
        and length(r.body) < ${STUB_CHARS}
        and (select count(*) from rumor_sources rs where rs.rumor_id = r.id) >= ${STUB_OUTLETS}
      order by r.published_at desc
    `),
  );

  const chosen = onlySlug ? targets.filter((t) => t.slug === onlySlug) : targets;
  console.log(
    `stub posts to grow: ${chosen.length}${onlySlug ? ` (filtered to ${onlySlug})` : ""}\n`,
  );

  for (const post of chosen) {
    console.log(`#${post.id} ${post.headline}`);
    console.log(`  before (${post.body.length} chars): ${post.body}`);

    const chain = rows<{
      title: string;
      raw_summary: string | null;
      publisher: string | null;
      source_name: string;
    }>(
      await db.execute(sql`
        select fi.title, fi.raw_summary, fi.publisher, s.name source_name
        from rumor_sources rs
        join sources s on s.id = rs.source_id
        join feed_items fi on fi.id = rs.feed_item_id
        where rs.rumor_id = ${post.id}
        order by rs.published_at
      `),
    );

    let body = post.body;
    let grew = 0;

    for (const item of chain) {
      if (!item.raw_summary) continue;
      let extraction;
      try {
        extraction = await extractRumor({
          title: item.title,
          rawSummary: item.raw_summary,
          publisher: item.publisher,
          sourceName: item.source_name,
        });
      } catch {
        continue;
      }
      if (!extraction.isRumor || !extraction.body) continue;

      const next = await enrichBody({
        headline: post.headline,
        current: body,
        incoming: extraction.body,
        incomingOutlet: item.publisher ?? item.source_name,
      });
      if (next && next !== body) {
        body = next;
        grew++;
      }
    }

    console.log(`  after  (${body.length} chars, ${grew} merges): ${body}\n`);

    if (apply && body !== post.body) {
      await db
        .update(rumors)
        .set({ body, bodyUpdatedAt: new Date() })
        .where(eq(rumors.id, post.id));
      console.log("  written\n");
    }
  }

  if (!apply) console.log("dry run — pass --apply to write");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
