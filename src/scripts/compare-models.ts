import { config } from "dotenv";
config({ path: ".env.local" });
import { sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";

const NL = String.fromCharCode(10);

/**
 * Run the same items through two models and print both results, bucketed by
 * how much text the extractor actually sees.
 *
 * Model choice is the biggest lever on the bill and the one place where it
 * shows in the product, so it is decided by reading the output rather than by
 * anyone opinion of the tier. Bucketing matters as much as the comparison:
 * the gap is a function of how much there is to mine, so a verdict from a
 * mixed sample says nothing about where to put the routing threshold.
 *
 *   npm run compare:models -- claude-sonnet-5
 */
const BUCKETS: [string, number, number][] = [
  ["400-1k", 400, 1000],
  ["1k-2k", 1000, 2000],
  ["2k+", 2000, 1e9],
];

async function main() {
  const rival = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "claude-sonnet-5";
  const { db } = await import("@/db");
  const { SCHEMA, SYSTEM } = await import("@/lib/extract");
  const { bestText } = await import("@/lib/article");
  const client = new Anthropic();

  /*
   * Only items that became published posts.
   * Sampling the newest feed rows instead put six non-NBA items in front of
   * both models, which each correctly refused to write up — comparing two
   * rejection placeholders says nothing about the prose on the site.
   */
  const res = await db.execute(sql`
    select f.url, f.title, coalesce(f.raw_summary, '') as body, s.slug,
           coalesce(nullif(f.publisher, ''), s.name) as outlet
      from feed_items f
      join sources s on s.id = f.source_id
      join rumors r on r.feed_item_id = f.id and r.is_published
     order by r.published_at desc limit 40`);
  const rows = (res.rows ?? res) as Record<string, string>[];

  // Bucket on the text the extractor sees, not the teaser in the database.
  const picked: { bucket: string; len: number; item: Record<string, string>; text: string }[] = [];
  for (const row of rows) {
    if (picked.length >= BUCKETS.length * 2) break;
    const t = await bestText({ url: row.url, rawSummary: row.body, sourceSlug: row.slug });
    const len = t.text?.length ?? 0;
    const b = BUCKETS.find(([, lo, hi]) => len >= lo && len < hi);
    if (!b) continue;
    if (picked.filter((p) => p.bucket === b[0]).length >= 2) continue;
    picked.push({ bucket: b[0], len, item: row, text: t.text ?? "" });
  }

  const cost: Record<string, number> = {};
  for (const p of picked.sort((a, b) => a.len - b.len)) {
    console.log(`${NL}=== [${p.bucket}] ${p.len} chars · ${p.item.slug} · ${p.item.title.slice(0, 62)}`);
    for (const model of ["claude-opus-5", rival]) {
      const r = await client.messages.create({
        model,
        max_tokens: 2000,
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: `Outlet: ${p.item.outlet}${NL}Headline: ${p.item.title}${NL}Summary: ${p.text.slice(0, 4000)}`,
          },
        ],
      });
      const t = r.content.find((b) => b.type === "text");
      const out = t && t.type === "text" ? (JSON.parse(t.text) as { headline: string; body: string }) : null;
      const inRate = model === "claude-opus-5" ? 5 : 2;
      const outRate = model === "claude-opus-5" ? 25 : 10;
      cost[model] =
        (cost[model] ?? 0) +
        ((r.usage.input_tokens + (r.usage.cache_read_input_tokens ?? 0) * 0.1) / 1e6) * inRate +
        (r.usage.output_tokens / 1e6) * outRate;
      console.log(`${NL}  [${model}]${NL}  ${out?.headline}${NL}  ${out?.body}`);
    }
  }
  console.log(
    `${NL}${NL}opus $${(cost["claude-opus-5"] ?? 0).toFixed(4)} · ${rival} $${(cost[rival] ?? 0).toFixed(4)}`,
  );
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
