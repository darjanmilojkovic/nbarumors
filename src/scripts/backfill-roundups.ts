import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync } from "node:fs";

/**
 * Re-ask "is this a roundup?" for posts flagged only because they had two or
 * more primary players.
 *
 * publish.ts used to set is_roundup whenever a post had more than one primary,
 * so every multi-player trade was stored as a survey. The column holds the OR
 * of that rule and the model's answer, and the model's half was never kept on
 * its own, so it is asked again here from the post's headline and summary,
 * with the field's own description. A post the model calls a single story is
 * cleared; one it calls a survey stays flagged.
 *
 *   npm run backfill:roundups -- --dry
 *   npm run backfill:roundups
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL!);
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const { SCHEMA } = await import("@/lib/extract");
  const client = new Anthropic();
  const MODEL = process.env.BACKFILL_MODEL ?? "claude-opus-5";
  const question = SCHEMA.properties.isRoundup.description;

  const posts = (await sql`
    select r.id, r.type, r.headline, r.body
      from rumors r
     where r.is_roundup
       and (select count(*) from rumor_players rp where rp.rumor_id = r.id and rp.is_primary) > 1
     order by r.created_at desc`) as { id: number; type: string; headline: string; body: string }[];
  console.log(`${posts.length} posts flagged roundup with two or more primaries`);

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
              properties: { isRoundup: { type: "boolean" } },
              required: ["isRoundup"],
              additionalProperties: false,
            },
          },
        },
        system: `You classify posts on an NBA transfer-news site. isRoundup: ${question}`,
        messages: [{ role: "user", content: `Headline: ${p.headline}\nSummary: ${p.body}` }],
      });
      if (res.stop_reason === "refusal") return null;
      const block = res.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") return null;
      return (JSON.parse(block.text) as { isRoundup: boolean }).isRoundup;
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

  const cleared = posts.filter((p) => verdicts.get(p.id) === false);
  const kept = posts.filter((p) => verdicts.get(p.id) === true);
  const failed = posts.filter((p) => verdicts.get(p.id) === null);
  console.log(`single stories, flag cleared: ${cleared.length}; real roundups, kept: ${kept.length}; no answer: ${failed.length}`);
  console.log("\nkept as roundups:");
  for (const p of kept) console.log(`  #${p.id} ${p.type.padEnd(11)} ${p.headline}`);
  console.log("\ncleared (sample):");
  for (const p of cleared.slice(0, 15)) console.log(`  #${p.id} ${p.type.padEnd(11)} ${p.headline}`);
  if (dryRun) {
    console.log("\n(dry run, nothing written)");
    return;
  }
  const file = `roundups-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(cleared.map((p) => p.id)));
  if (cleared.length) await sql`update rumors set is_roundup = false where id = any(${cleared.map((p) => p.id)})`;
  console.log(`\ncleared ${cleared.length}; ids in ${file} (set is_roundup back to true on those to undo)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
