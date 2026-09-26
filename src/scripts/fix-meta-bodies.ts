import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync } from "node:fs";

/**
 * Rewrite posts whose summary describes the article instead of what it
 * reports ("The piece argues...") or closes on a disclaimer ("None of this
 * reflects an actual offer, just analysis").
 *
 * `talksAboutTheItem` now sends these back for one retry at extraction, but a
 * rule change only reaches items extracted after it: 19 of 1,171 posts in the
 * 60 days to 26 Sep 2026 already read this way.
 *
 * Only that wording is wrong, so only that wording changes. The model gets
 * the existing body and restates the claims directly, keeping every fact,
 * figure and name. body_updated_at is left alone: this is a copy edit, not
 * news, and the card should not claim the story moved.
 *
 *   npm run fix:meta -- --dry
 *   npm run fix:meta -- --apply
 */
async function main() {
  const apply = process.argv.includes("--apply");

  const { db } = await import("@/db");
  const { rumors } = await import("@/db/schema");
  const { sql, eq } = await import("drizzle-orm");
  const { talksAboutTheItem, SCHEMA } = await import("@/lib/extract");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();
  const MODEL = process.env.EXTRACTION_MODEL ?? "claude-opus-5";

  const res = await db.execute(sql`
    select id, slug, headline, body from rumors where is_published order by published_at desc`);
  const posts = ((res.rows ?? res) as Record<string, unknown>[])
    .map((r) => ({ id: Number(r.id), slug: String(r.slug), headline: String(r.headline), body: String(r.body) }))
    .filter((p) => talksAboutTheItem(p.body));
  console.log(`${posts.length} post(s) to rewrite\n`);
  if (!posts.length) return;

  if (apply) {
    const file = `meta-bodies-${Date.now()}.json`;
    writeFileSync(file, JSON.stringify(posts.map((p) => ({ id: String(p.id), slug: p.slug, body: p.body })), null, 2));
    console.log(`old values saved to ${file}`);
    console.log(`undo with: npm run restore:body -- ${file} <slug>\n`);
  }

  let changed = 0;
  for (const post of posts) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { body: SCHEMA.properties.body },
            required: ["body"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "user",
          content: [
            `This summary talks about the article it came from instead of simply stating what it reports: "The piece argues...", "The article notes...", "cited in the piece", or it ends on a disclaimer such as "None of this reflects an actual offer, just analysis" or "this is speculation".`,
            ``,
            `Rewrite only those parts. State the claims themselves. Where nothing has happened, carry that in a conditional verb ("could", "would", "is floated as") rather than a sentence about the article. Delete disclaimer sentences outright; the card already shows a status badge.`,
            ``,
            `Keep every fact, figure, name, attribution to a named reporter or other outlet, and paragraph break. Do not add anything. Do not reword sentences that are already fine.`,
            ``,
            `Headline: ${post.headline}`,
            ``,
            `Summary:`,
            post.body,
          ].join("\n"),
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text");
    if (response.stop_reason === "refusal" || !text || text.type !== "text") {
      console.log(`#${post.id} SKIPPED (no answer)`);
      continue;
    }
    const next = (JSON.parse(text.text) as { body: string }).body.trim();

    // Refuse a rewrite that kept the wording, gutted the post or echoed the prompt.
    const problem = talksAboutTheItem(next)
      ? "still talks about the article"
      : next.length < post.body.length * 0.6
        ? `cut from ${post.body.length} to ${next.length} chars`
        : /^(headline|summary):/i.test(next)
          ? "echoed the prompt"
          : null;
    if (problem) {
      console.log(`#${post.id} SKIPPED (${problem})`);
      continue;
    }

    console.log(`#${post.id} ${post.headline}\n  BEFORE: ${post.body.replace(/\n+/g, " ")}\n  AFTER:  ${next.replace(/\n+/g, " ")}\n`);
    if (apply) {
      await db.update(rumors).set({ body: next }).where(eq(rumors.id, post.id));
    }
    changed++;
  }
  console.log(`${apply ? "rewrote" : "would rewrite"} ${changed} of ${posts.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
