import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync } from "node:fs";

/**
 * Re-ask the status of posts marked "debunked" under the sharpened definition.
 *
 * The schema said only "debunked = denied", and the model read "passed on",
 * "turned down" and "talks fizzled" as denials: on 27 Sep 2026, most of 33
 * debunked posts were reports of deals that fell through, not reports shown
 * false. Debunked docks a post 30 points and prints a red badge, so they were
 * buried for being news. Asks with the live status description.
 *
 *   npm run reclassify:debunked -- --dry
 *   npm run reclassify:debunked
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL!);
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const { SCHEMA } = await import("@/lib/extract");
  const client = new Anthropic();
  const MODEL = process.env.BACKFILL_MODEL ?? "claude-opus-5";
  const statusField = SCHEMA.properties.status;

  const posts = (await sql`
    select id, headline, body from rumors where is_published and status = 'debunked' order by published_at desc`) as {
    id: number;
    headline: string;
    body: string;
  }[];

  const ask = async (p: (typeof posts)[number]): Promise<string | null> => {
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
              properties: { status: statusField },
              required: ["status"],
              additionalProperties: false,
            },
          },
        },
        system: "You classify posts on an NBA transfer-news site by how far along the deal is.",
        messages: [{ role: "user", content: `Headline: ${p.headline}\nSummary: ${p.body}` }],
      });
      if (res.stop_reason === "refusal") return null;
      const block = res.content.find((b) => b.type === "text");
      if (!block || block.type !== "text") return null;
      return (JSON.parse(block.text) as { status: string }).status;
    } catch {
      return null;
    }
  };

  const changes: { id: number; headline: string; to: string }[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < posts.length) {
        const p = posts[cursor++];
        const to = await ask(p);
        if (to && to !== "debunked") changes.push({ id: p.id, headline: p.headline, to });
      }
    }),
  );

  console.log(`${posts.length} debunked posts; ${changes.length} re-labelled, ${posts.length - changes.length} stay debunked`);
  for (const c of changes) console.log(`  #${c.id} -> ${c.to.padEnd(9)} ${c.headline}`);
  const stay = posts.filter((p) => !changes.some((c) => c.id === p.id));
  console.log("\nstay debunked:");
  for (const p of stay) console.log(`  #${p.id} ${p.headline}`);
  if (dryRun) {
    console.log("\n(dry run, nothing written)");
    return;
  }
  const file = `debunked-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(changes.map((c) => c.id)));
  for (const c of changes) await sql`update rumors set status = ${c.to} where id = ${c.id}`;
  console.log(`\nwritten; ids in ${file} (set status back to 'debunked' on those to undo)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
