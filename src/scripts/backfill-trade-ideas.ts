import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync } from "node:fs";

/**
 * Flag trade ideas among recent posts, since extraction only started asking
 * on 26 Sep 2026.
 *
 * Reads each post's own headline and summary (no article fetch, no full
 * extraction) and asks the same question extraction now asks, using the
 * field's own description so the two cannot drift apart. Flagged posts leave
 * Trending and Top Rated; flagged posts that were held back are published,
 * which is the rule new pitches follow. Posts hidden because they were merged
 * into another are skipped: their report now lives on the survivor.
 *
 *   npm run backfill:trade-ideas -- [days, default 14] [--dry]
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const days = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 14);

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL!);
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const { SCHEMA } = await import("@/lib/extract");
  const client = new Anthropic();
  const MODEL = process.env.BACKFILL_MODEL ?? "claude-opus-5";

  const question = SCHEMA.properties.isTradeIdea.description;

  const posts = (await sql`
    select r.id, r.headline, r.body, r.is_published, r.is_trade_idea
      from rumors r
     where r.created_at > now() - make_interval(days => ${days})
       and (r.is_published or not exists (
             select 1 from rumor_sources rs join rumors k on k.id = rs.rumor_id and k.is_published
              where rs.feed_item_id = r.feed_item_id))
     order by r.created_at desc`) as {
    id: number;
    headline: string;
    body: string;
    is_published: boolean;
    is_trade_idea: boolean;
  }[];
  console.log(`${posts.length} posts from the last ${days} days`);

  const ask = async (p: (typeof posts)[number]): Promise<boolean | null> => {
    try {
      const res = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 1000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: {
          effort: "low",
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: { isTradeIdea: { type: "boolean" } },
              required: ["isTradeIdea"],
              additionalProperties: false,
            },
          },
        },
        system: `You classify posts on an NBA transfer-news site. isTradeIdea: ${question}`,
        messages: [{ role: "user", content: `Headline: ${p.headline}\nSummary: ${p.body}` }],
      });
      if (res.stop_reason === "refusal") return null;
      const block = res.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") return null;
      return (JSON.parse(block.text) as { isTradeIdea: boolean }).isTradeIdea;
    } catch {
      return null;
    }
  };

  const verdicts = new Map<number, boolean | null>();
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < posts.length) {
        const p = posts[cursor++];
        verdicts.set(p.id, await ask(p));
      }
    }),
  );

  const ideas = posts.filter((p) => verdicts.get(p.id) === true);
  const failed = posts.filter((p) => verdicts.get(p.id) === null);
  const released = ideas.filter((p) => !p.is_published);
  console.log(`trade ideas: ${ideas.length} (${ideas.length - released.length} published, ${released.length} held and to be published)`);
  if (failed.length) console.log(`no answer, left as is: ${failed.length}`);
  for (const p of ideas) console.log(`  ${p.is_published ? "   " : "NEW"} #${p.id} ${p.headline}`);
  if (dryRun) {
    console.log("\n(dry run, nothing written)");
    return;
  }

  const file = `trade-ideas-${Date.now()}.json`;
  writeFileSync(
    file,
    JSON.stringify(ideas.map((p) => ({ id: p.id, is_published: p.is_published, is_trade_idea: p.is_trade_idea })), null, 1),
  );
  const ids = ideas.map((p) => p.id);
  if (ids.length) {
    await sql`update rumors set is_trade_idea = true where id = any(${ids})`;
    await sql`update rumors set is_published = true where id = any(${released.map((p) => p.id)})`;
  }
  console.log(`\nwritten; previous values in ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
