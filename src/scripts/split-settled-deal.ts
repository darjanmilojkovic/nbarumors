import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";

/**
 * Take a done deal back out of the rumour posts it merged into.
 *
 * Before 26 Sep 2026 a signing reported by twenty outlets folded into
 * whichever speculation post about it came first, and those posts kept their
 * speculative headlines with the signing written into their bodies. This
 * undoes one such case:
 *
 *   1. backs up the posts and their source rows to JSON;
 *   2. detaches every report filed at or after the cutoff;
 *   3. rebuilds each published old post from its own pre-cutoff reports, back
 *      to an open status. A hidden one only has its status reopened, so the
 *      deal cannot merge back into it;
 *   4. publishes the deal from the chosen report through the normal
 *      pipeline, and attaches the other detached reports to it;
 *   5. points the published old posts at the new one.
 *
 * Writes to the live site. --dry-run lists what would move and stops before
 * any model call or write.
 *
 *   npm run split:deal -- <rumorIds,comma,separated> <cutoff ISO> <origin feed item id> [--dry-run]
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const [idsArg, cutoffArg, originArg] = args.filter((a) => !a.startsWith("--"));
  const rumorIds = (idsArg ?? "").split(",").map(Number).filter(Boolean);
  const cutoff = new Date(cutoffArg);
  const originItemId = Number(originArg);
  if (!rumorIds.length || Number.isNaN(cutoff.getTime()) || !originItemId) {
    throw new Error("usage: <rumorIds> <cutoff ISO> <origin feed item id> [--dry-run]");
  }

  const { db } = await import("@/db");
  const { rumors } = await import("@/db/schema");
  const { bestText } = await import("@/lib/article");
  const { extractRumor } = await import("@/lib/extract");
  const { enrichBody } = await import("@/lib/enrich");
  const { attachSource, publishExtraction } = await import("@/lib/publish");
  const { pruneStaleTags } = await import("@/lib/tags");

  const rows = <T>(r: unknown) => ((r as { rows?: T[] }).rows ?? r) as T[];

  type Post = { id: number; feed_item_id: number; headline: string; is_published: boolean; status: string };
  const posts = rows<Post>(
    await db.execute(sql`
      select id, feed_item_id, headline, is_published, status
        from rumors where id in ${rumorIds} order by id`),
  );

  type Src = {
    feed_item_id: number;
    rumor_id: number;
    source_id: number;
    url: string;
    title: string;
    raw_summary: string | null;
    publisher: string | null;
    published_at: string;
    slug: string;
    source_name: string;
  };
  const sources = rows<Src>(
    await db.execute(sql`
      select rs.feed_item_id, rs.rumor_id, f.source_id, f.url, f.title, f.raw_summary,
             f.publisher, f.published_at, s.slug, s.name as source_name
        from rumor_sources rs
        join feed_items f on f.id = rs.feed_item_id
        join sources s on s.id = f.source_id
       where rs.rumor_id in ${rumorIds}
       order by f.published_at asc`),
  );
  const moving = sources.filter((s) => new Date(s.published_at) >= cutoff);
  const origin = moving.find((s) => s.feed_item_id === originItemId);
  if (!origin) throw new Error(`feed item ${originItemId} is not among the reports after the cutoff`);

  for (const p of posts) {
    const own = sources.filter((s) => s.rumor_id === p.id);
    const kept = own.filter((s) => new Date(s.published_at) < cutoff).length;
    console.log(
      `#${p.id} ${p.is_published ? "published" : "HIDDEN"} ${p.status}: keeps ${kept}, loses ${own.length - kept} — ${p.headline}`,
    );
  }
  console.log(`\n${moving.length} reports move to the new post (origin marked *):`);
  for (const s of moving) {
    console.log(`  ${s === origin ? "*" : " "} from #${s.rumor_id}  ${s.slug.padEnd(20)} ${s.title.slice(0, 70)}`);
  }

  /*
   * Anything settled the deal could merge into instead of publishing. The old
   * posts are reopened before the publish, so they are excluded here.
   */
  const settled = rows<{ id: number; is_published: boolean; headline: string; event_key: string }>(
    await db.execute(sql`
      select r.id, r.is_published, r.headline, r.event_key
        from rumors r
        join rumor_players rp on rp.rumor_id = r.id and rp.is_primary
       where rp.player_id in (
               select rp2.player_id from rumor_players rp2
                where rp2.rumor_id in ${rumorIds} and rp2.is_primary)
         and r.status in ('confirmed', 'completed')
         and r.id not in ${rumorIds}
         and r.published_at > now() - interval '90 days'`),
  );
  console.log(`\nother settled posts on the same player in 90 days: ${settled.length}`);
  for (const s of settled) console.log(`  #${s.id} ${s.is_published ? "" : "HIDDEN "}${s.event_key} — ${s.headline}`);
  if (dryRun) return;

  // 1. Backup.
  const backup = {
    rumors: rows(await db.execute(sql`select * from rumors where id in ${rumorIds}`)),
    rumorSources: rows(await db.execute(sql`select * from rumor_sources where rumor_id in ${rumorIds}`)),
  };
  const file = `split-deal-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(backup, null, 1));
  console.log(`\nbacked up to ${file}`);

  const extract = async (s: Src) => {
    const text = await bestText({ url: s.url, rawSummary: s.raw_summary, sourceSlug: s.slug });
    return extractRumor({
      title: s.title,
      rawSummary: text.text,
      publisher: s.publisher,
      sourceName: s.source_name,
    });
  };

  // 2. Detach.
  await db.execute(sql`delete from rumor_sources where feed_item_id in ${moving.map((s) => s.feed_item_id)}`);

  // 3. Rebuild the published posts; reopen the hidden ones.
  for (const post of posts) {
    const own = sources.filter((s) => s.rumor_id === post.id && new Date(s.published_at) < cutoff);
    if (!post.is_published) {
      await db.update(rumors).set({ status: "reported" }).where(sql`${rumors.id} = ${post.id}`);
      console.log(`\n#${post.id} hidden: status reopened to reported, nothing else changed`);
      continue;
    }
    const first = own.find((s) => s.feed_item_id === post.feed_item_id) ?? own[0];
    if (!first) {
      console.log(`\n#${post.id}: no reports before the cutoff; left as is`);
      continue;
    }
    const base = await extract(first);
    let body = base.body;
    const statuses = [base.status];
    for (const s of own) {
      if (s === first) continue;
      const incoming = await extract(s);
      statuses.push(incoming.status);
      const grown = await enrichBody({
        headline: post.headline,
        current: body,
        incoming: incoming.body,
        incomingOutlet: s.publisher ?? s.slug,
      });
      if (grown) body = grown;
    }
    // The firmest of its own reports, but never settled: none of them was the deal.
    const status = statuses.includes("reported") ? "reported" : "rumor";
    await db
      .update(rumors)
      .set({
        body,
        status,
        contractValue: base.contractValue?.slice(0, 24) ?? null,
        contractYears: base.contractYears ?? null,
        bodyUpdatedAt: own.length > 1 ? new Date() : null,
      })
      .where(sql`${rumors.id} = ${post.id}`);
    await pruneStaleTags(post.id);
    console.log(`\n#${post.id} rebuilt from ${own.length} reports, status ${status}:\n  ${body.replace(/\n+/g, "\n  ")}`);
  }

  // 4. Publish the deal, then attach the rest.
  const dealExtraction = await extract(origin);
  const result = await publishExtraction(
    {
      id: origin.feed_item_id,
      sourceId: origin.source_id,
      url: origin.url,
      title: origin.title,
      publisher: origin.publisher,
      publishedAt: new Date(origin.published_at),
      sourceSlug: origin.slug,
    },
    dealExtraction,
  );
  if (result.status !== "published") {
    throw new Error(
      `the deal did not publish (${result.status}${"rumorId" in result ? ` into #${result.rumorId}` : ""}); ` +
        `${moving.length - 1} reports are still detached; backup in ${file}`,
    );
  }
  const newId = result.rumorId;
  console.log(`\npublished #${newId}: ${dealExtraction.headline} [${dealExtraction.status}]`);

  for (const s of moving) {
    if (s === origin) continue;
    const [current] = rows<{
      status: string;
      confidence: number;
      published_at: string;
      contract_value: string | null;
      contract_years: number | null;
      headline: string;
      body: string;
      slug: string;
    }>(
      await db.execute(sql`
        select r.status, r.confidence, r.published_at, r.contract_value, r.contract_years,
               r.headline, r.body, s.slug
          from rumors r join sources s on s.id = r.source_id where r.id = ${newId}`),
    );
    await attachSource(
      newId,
      {
        status: current.status,
        confidence: current.confidence,
        publishedAt: new Date(current.published_at),
        sourceSlug: current.slug,
        contractValue: current.contract_value,
        contractYears: current.contract_years,
        headline: current.headline,
        body: current.body,
      },
      {
        id: s.feed_item_id,
        sourceId: s.source_id,
        url: s.url,
        title: s.title,
        publisher: s.publisher,
        publishedAt: new Date(s.published_at),
        sourceSlug: s.slug,
      },
      await extract(s),
    );
    console.log(`  attached ${s.slug}`);
  }

  // 5. Link the published rumours to the deal; an "unrecorded" label no longer applies.
  const linked = posts.filter((p) => p.is_published).map((p) => p.id);
  if (linked.length) {
    await db
      .update(rumors)
      .set({ outcomeRumorId: newId })
      .where(sql`${rumors.id} in ${linked}`);
    await db.execute(sql`
      update rumors set outcome = null, outcome_at = null
       where id in ${linked} and outcome = 'unrecorded'`);
  }

  const [final] = rows<Record<string, unknown>>(
    await db.execute(sql`
      select id, slug, status, headline, contract_value, contract_years, is_published, body,
             (select count(*)::int from rumor_sources where rumor_id = ${newId}) as sources
        from rumors where id = ${newId}`),
  );
  console.log("\nnew post:", final);
  console.log(`\nlinked #${linked.join(", #")} → #${newId}. Undo from ${file}.`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
