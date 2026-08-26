import { config } from "dotenv";
config({ path: ".env.local" });
import { eq, sql } from "drizzle-orm";
import { writeFileSync } from "node:fs";

/**
 * Replace front-office jargon with the word a reader would use.
 *
 * "Svyatoslav Rovenchuk at LakeShowLife, in a framework picked up by Heavy"
 * should say "in a trade rumor". A proposed trade is a trade idea, a proposal
 * or a rumor; "framework" is what executives call it, and on a wire it reads
 * as borrowed vocabulary.
 *
 * The word list lives in lib/enrich beside the guard that enforces it, so a
 * new entry both blocks future posts and sweeps the archive for old ones.
 *
 *   npm run fix:jargon -- --dry
 *   npm run fix:jargon
 */
async function main() {
  const dryRun = process.argv.includes("--dry");
  const { db } = await import("@/db");
  const { rumors } = await import("@/db/schema");
  const { SCHEMA } = await import("@/lib/extract");
  const { rejectBody, JARGON } = await import("@/lib/enrich");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();
  const MODEL = process.env.EXTRACTION_MODEL ?? "claude-opus-5";

  const pattern = JARGON.join("|");
  const res = await db.execute(sql`
    select id, slug, headline, body from rumors
     where is_published and (headline ~* ${pattern} or body ~* ${pattern})
     order by published_at desc`);
  const rows = (res.rows ?? res) as Record<string, string>[];
  console.log(`${rows.length} posts use one of: ${JARGON.join(", ")}\n`);

  if (!dryRun && rows.length) {
    const file = `jargon-${Date.now()}.json`;
    writeFileSync(file, JSON.stringify(rows, null, 2));
    console.log(`old values saved to ${file}\n`);
  }

  let changed = 0;
  const skipped: string[] = [];

  for (const r of rows) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 900,
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { headline: SCHEMA.properties.headline, body: SCHEMA.properties.body },
            required: ["headline", "body"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "user",
          content: [
            `Rewrite this post so it does not use the word "${JARGON.join('" or "')}". A proposed trade is a trade idea, a proposal, a trade rumor or a deal — say it the way a reader would.`,
            ``,
            `Change nothing else. Every fact, figure, name and sentence stays exactly as it is; only the jargon is replaced, and only where replacing it reads naturally.`,
            ``,
            `Headline: ${r.headline}`,
            `Summary: ${r.body}`,
          ].join("\n"),
        },
      ],
    });

    const t = response.content.find((b) => b.type === "text");
    if (!t || t.type !== "text") {
      skipped.push(`${r.slug}: no text block`);
      continue;
    }
    let parsed: { headline: string; body: string };
    try {
      parsed = JSON.parse(t.text);
    } catch {
      skipped.push(`${r.slug}: unparseable response`);
      continue;
    }

    const stillJargon = new RegExp(pattern, "i").test(`${parsed.headline} ${parsed.body}`);
    const bad = stillJargon ? "jargon survived the rewrite" : rejectBody(parsed.body, r.body);
    if (bad) {
      skipped.push(`${r.slug}: ${bad}`);
      continue;
    }

    changed++;
    console.log(`— ${r.slug}`);
    if (parsed.headline !== r.headline) console.log(`  ${r.headline}\n→ ${parsed.headline}`);
    console.log(`  ${parsed.body}\n`);
    if (!dryRun) {
      await db
        .update(rumors)
        .set({ headline: parsed.headline, body: parsed.body })
        .where(eq(rumors.id, Number(r.id)));
    }
  }

  console.log(`${dryRun ? "would rewrite" : "rewrote"} ${changed} of ${rows.length}`);
  if (skipped.length) {
    console.log(`\nleft alone (${skipped.length}):`);
    for (const s of skipped) console.log(`  ${s}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
