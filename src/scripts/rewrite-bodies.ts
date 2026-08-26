import { config } from "dotenv";
config({ path: ".env.local" });
import { eq, sql } from "drizzle-orm";

/**
 * Rewrite the bodies of posts written before the attribution rules changed.
 *
 * 479 of 483 transaction posts carried one of thirteen near-identical clauses,
 * 241 of them the exact words "per the official transaction log". The prompt
 * is fixed for new items; this brings the archive into line.
 *
 * Only the body is rewritten. Headlines, slugs, event keys, teams, players and
 * dates are all left alone — this is a rephrasing, not a re-extraction, so
 * nothing that anything else depends on can move.
 *
 *   npm run fix:bodies -- --dry --limit 10
 *   npm run fix:bodies
 */
const IN_RATE = Number(process.env.PRICE_IN_PER_MTOK ?? 5);
const OUT_RATE = Number(process.env.PRICE_OUT_PER_MTOK ?? 25);

async function main() {
  const dryRun = process.argv.includes("--dry");
  const li = process.argv.indexOf("--limit");
  const limit = li > -1 ? Number(process.argv[li + 1]) : null;

  const { db } = await import("@/db");
  const { rumors, feedItems, sources } = await import("@/db/schema");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();
  const MODEL = process.env.EXTRACTION_MODEL ?? "claude-opus-5";

  const rows = await db
    .select({
      id: rumors.id,
      slug: rumors.slug,
      headline: rumors.headline,
      body: rumors.body,
      outlet: sources.name,
      title: feedItems.title,
      rawSummary: feedItems.rawSummary,
    })
    .from(rumors)
    .leftJoin(feedItems, eq(feedItems.id, rumors.feedItemId))
    .leftJoin(sources, eq(sources.id, rumors.sourceId))
    .where(sql`${rumors.isPublished} and ${rumors.body} ilike '%official transaction%'`)
    .orderBy(sql`${rumors.publishedAt} desc`)
    .limit(limit ?? 10_000);

  console.log(`${rows.length} posts to rephrase\n`);

  const SCHEMA = {
    type: "object",
    properties: {
      body: {
        type: "string",
        description:
          "2-3 original sentences restating these facts. Attribute plainly and vary the wording: 'the move is now official', 'it is on the league transaction log', 'officially logged, no terms disclosed'. Do not use the phrase 'official transaction log' or 'official transaction record' verbatim, and never write 'according to sources'. Keep every fact exactly as given — invent nothing, drop nothing. Punchy and dry; no hype.",
      },
    },
    required: ["body"],
    additionalProperties: false,
  } as const;

  let inTok = 0, outTok = 0, changed = 0;
  for (const r of rows) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: `Rephrase this post's summary. Outlet: ${r.outlet}\nHeadline: ${r.headline}\nOriginal item: ${r.title ?? ""} — ${r.rawSummary ?? ""}\n\nCurrent summary:\n${r.body}`,
      }],
    });
    inTok += res.usage.input_tokens; outTok += res.usage.output_tokens;
    if (res.stop_reason === "refusal") continue;
    const t = res.content.find((b) => b.type === "text");
    if (!t || t.type !== "text") continue;
    let parsed: { body: string };
    try { parsed = JSON.parse(t.text); } catch { console.log(`  ! unparseable: ${r.slug}`); continue; }
    if (!parsed.body || parsed.body === r.body) continue;

    changed++;
    console.log(`— ${r.slug.slice(0, 56)}`);
    console.log(`  OLD: ${r.body}`);
    console.log(`  NEW: ${parsed.body}\n`);
    if (!dryRun) await db.update(rumors).set({ body: parsed.body }).where(eq(rumors.id, r.id));
  }

  const cost = (inTok / 1e6) * IN_RATE + (outTok / 1e6) * OUT_RATE;
  console.log(`${dryRun ? "would rewrite" : "rewrote"} ${changed} of ${rows.length}`);
  console.log(`tokens: ${inTok.toLocaleString()} in · ${outTok.toLocaleString()} out`);
  console.log(`cost: $${cost.toFixed(4)} for these ${rows.length} → ~$${((cost / Math.max(rows.length,1)) * 483).toFixed(2)} for all 483`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
