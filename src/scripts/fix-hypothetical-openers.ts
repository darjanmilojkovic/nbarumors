import { config } from "dotenv";
config({ path: ".env.local" });
import { eq, sql } from "drizzle-orm";
import { writeFileSync } from "node:fs";

/**
 * Rewrite headlines and summaries that open by labelling themselves.
 *
 * Three posts in a row down the Celtics page read "Hypothetical swap sends
 * Durant to Boston", "Hypothetical trade sends Lillard to Boston",
 * "Hypothetical trade sends Kyrie Irving back to Boston" — the same word three
 * times before any of them says anything, on cards that already print a Trade
 * rumor kicker and a Developing badge. Nineteen summaries open "A proposed
 * framework would", which reads as a template rather than a report.
 *
 * The label is not wrong, it is just the third time the reader is told. The
 * conditional belongs in the verb, where it costs nothing: "would send",
 * "is floated as".
 *
 * The prompt now forbids both openings. This is for what it already wrote.
 *
 *   npm run fix:hypotheticals -- --dry
 *   npm run fix:hypotheticals
 */
const OPENER = /^(a |one )?(hypothetical|proposed|speculative|mock)\b/i;

/*
 * Phrasings that have become a house style rather than a choice.
 *
 * The first pass at this replaced one formula with another: telling the model
 * to "let the verb carry the conditional: would send, is floated as" produced
 * nine headlines saying "would land" and fourteen saying "floated", which on a
 * team page reads exactly as repetitive as the word it replaced. Examples in a
 * prompt do not suggest a register, they supply a template.
 */
const CRUTCH = /(would land|\bfloated\b|would send|proposed framework)/i;

function reject(next: { headline: string; body: string }, old: { headline: string; body: string }) {
  if (OPENER.test(next.headline)) return "headline still opens with the label";
  // The word anywhere in a headline is redundant beside a Trade rumor kicker.
  if (/(hypothetical|speculative|mock)/i.test(next.headline)) return "headline still carries the label";
  if (CRUTCH.test(next.headline)) return "headline reuses a worn phrase";
  if (OPENER.test(next.body)) return "summary still opens with the label";
  if (next.headline.length > 90) return "headline too long";
  if (next.headline === old.headline && next.body === old.body) return "unchanged";
  if (/—/.test(next.body) || /—/.test(next.headline)) return "em dash";
  if (next.body.length < old.body.length * 0.8) return "summary lost substance";
  if (/[\u0000-\u0008\u000B-\u001F]/.test(next.body)) return "control characters";
  return null;
}

async function main() {
  const dryRun = process.argv.includes("--dry");
  const { db } = await import("@/db");
  const { rumors } = await import("@/db/schema");
  const { SCHEMA } = await import("@/lib/extract");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();
  const MODEL = process.env.EXTRACTION_MODEL ?? "claude-opus-5";

  const res = await db.execute(sql`
    select id, slug, headline, body from rumors
     where is_published
       and (headline ~* '^(hypothetical|proposed|speculative|mock)'
         or headline ~* '(hypothetical|speculative|mock|would land|floated|would send)'
         or body ~* '^(a |one )?(proposed|hypothetical|speculative|mock)')
     order by published_at desc`);
  const rows = (res.rows ?? res) as Record<string, string>[];
  console.log(`${rows.length} posts open by labelling themselves\n`);

  if (!dryRun && rows.length) {
    const file = `hypothetical-openers-${Date.now()}.json`;
    writeFileSync(file, JSON.stringify(rows, null, 2));
    console.log(`old values saved to ${file}\n`);
  }

  let changed = 0;
  const skipped: string[] = [];

  /*
   * Headlines already written in this run, fed back as constructions to avoid.
   *
   * Each item is extracted alone and cannot see its neighbours, which is why
   * they converge: nothing tells the model that the last four posts on this
   * page all began the same way. Showing it what has just been used is the
   * only thing that produces variety across a page rather than within a
   * sentence.
   */
  const used: string[] = [];

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
            `Rewrite this post's headline and summary. The headline must not contain "Hypothetical", "Speculative" or "Mock", and neither may OPEN with a label like "Proposed" or "A proposed framework". The card already shows a Trade rumor kicker and a Developing badge, so the label is the third time a reader is told.`,
            ``,
            `It must also avoid "would land", "floated" and "would send", which have been used so often across the site that they read as a house formula rather than a choice.`,
            ``,
            `Lead with the players and teams. Carry the conditional however the sentence wants it — a verb, a clause, a colon, naming who is doing the proposing. Keep every fact exactly as it is, add nothing, and do not change the meaning: the deal is still hypothetical and must still read that way.`,
            ...(used.length
              ? [
                  ``,
                  `Constructions already used on this site. Do not echo their shape:`,
                  ...used.slice(-8).map((h) => `  ${h}`),
                ]
              : []),
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

    const bad = reject(parsed, { headline: r.headline, body: r.body });
    if (bad) {
      skipped.push(`${r.slug}: ${bad}`);
      continue;
    }

    changed++;
    used.push(parsed.headline);
    console.log(`— ${r.headline}\n→ ${parsed.headline}`);
    if (parsed.body !== r.body) console.log(`   ${parsed.body.slice(0, 120)}…`);
    console.log();
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
