import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Rewrite the openings of posts whose summary starts by naming the outlet.
 *
 * `extractRumor` now retries when this happens, but a rule change only reaches
 * items extracted after it. 13 of 726 published posts already open this way —
 * "Basketball-Reference's transaction log records...", "RealGM reports..." —
 * and nothing would ever revisit them.
 *
 * Only the opening is at stake, so only the opening is rewritten. The model is
 * given the existing body and asked to recast the first sentence without the
 * masthead, keeping every fact and every other sentence as they are. That is a
 * much narrower request than re-extracting, which would rewrite copy that is
 * not wrong and would cost the full extraction price on each.
 *
 *   npx tsx src/scripts/fix-outlet-openers-2.ts --dry
 *   npx tsx src/scripts/fix-outlet-openers-2.ts --apply
 */

async function main() {
  const apply = process.argv.includes("--apply");

  const { db } = await import("@/db");
  const { rumors } = await import("@/db/schema");
  const { sql, eq } = await import("drizzle-orm");
  const { opensWithOutlet } = await import("@/lib/extract");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();

  const rows = <T,>(r: unknown): T[] =>
    ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as T[];

  const posts = rows<{
    id: number;
    body: string;
    headline: string;
    outlet: string;
    publisher: string | null;
  }>(
    await db.execute(sql`
      select r.id, r.body, r.headline, s.name outlet,
             (select rs.publisher from rumor_sources rs
               where rs.rumor_id = r.id and rs.publisher is not null limit 1) publisher
      from rumors r join sources s on s.id = r.source_id
      where r.is_published
    `),
  );

  const targets = posts.filter((p) =>
    opensWithOutlet(p.body, [p.publisher, p.outlet]),
  );
  console.log(`posts opening with an outlet name: ${targets.length}\n`);

  for (const post of targets) {
    const res = await client.messages.create({
      model: process.env.EXTRACTION_MODEL ?? "claude-sonnet-5",
      max_tokens: 700,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { body: { type: "string" } },
            required: ["body"],
            additionalProperties: false,
          },
        },
      },
      system: [
        {
          type: "text",
          text: `You fix the opening sentence of a short NBA transfer summary.

The summary currently begins by naming the outlet that published it. The website prints that outlet directly above the text, as a link, so the reader can already see it and the words are wasted.

Rewrite ONLY so that the summary no longer opens with the outlet as the subject of its first sentence. Open with the substance instead: the player, the teams, the terms, the mechanism, or a named reporter.

Keep every fact. Keep every other sentence exactly as it is. Keep the paragraph breaks. Do not add anything the text does not already contain, and do not remove a detail to make the sentence easier.

Naming a person is fine and often better: "Tim MacMahon reports" earns its place where "ESPN reports" does not. Naming the outlet later in the summary is fine. It is only the opening that is wrong.

No em dashes. Do not write that an outlet "relays" anything.`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Headline: ${post.headline}\n\nSummary:\n${post.body}`,
        },
      ],
    });

    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") continue;
    const next = (JSON.parse(text.text) as { body: string }).body;

    /*
     * Refuse a rewrite that shortened the post, failed to fix the opener, or
     * echoed the scaffolding back.
     *
     * The last one is not hypothetical: one attempt returned "Headline: ...
     * Summary: ..." as the body, which would have written the prompt's own
     * labels onto the page. A dry run caught it; a guard is what stops the
     * next one.
     */
    const stillWrong = opensWithOutlet(next, [post.publisher, post.outlet]);
    const shrank = next.length < post.body.length * 0.85;
    const echoed = /^\s*(headline|summary)\s*:/i.test(next) || /\n\s*Summary\s*:/i.test(next);
    if (stillWrong || shrank || echoed) {
      const why = stillWrong
        ? "still opens with the outlet"
        : echoed
          ? "echoed the prompt scaffolding"
          : "shrank";
      console.log(`#${post.id} SKIPPED (${why})`);
      console.log(`   ${next.slice(0, 90)}\n`);
      continue;
    }

    console.log(`#${post.id}`);
    console.log(`   before: ${post.body.slice(0, 88)}`);
    console.log(`   after : ${next.slice(0, 88)}\n`);

    if (apply) {
      await db.update(rumors).set({ body: next }).where(eq(rumors.id, post.id));
    }
  }

  if (!apply) console.log("dry run — pass --apply to write");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
