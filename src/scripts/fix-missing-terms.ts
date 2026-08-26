import { config } from "dotenv";
config({ path: ".env.local" });
import { eq, sql } from "drizzle-orm";
import { writeFileSync } from "node:fs";

/**
 * Recover contract terms that a merge threw away, and stop the post denying
 * they exist.
 *
 * Outlets split the work: one files that a signing happened, another files
 * what it is worth. Collapsing them kept only the survivor's side, so the
 * DeRozan post read "No financial terms were included in the report" while the
 * RealGM item merged into it — visible in the corroboration chain, on the same
 * page — said one year, $3.9M.
 *
 * The figure was never lost, only orphaned: a merged-away duplicate is
 * unpublished rather than deleted, and its own row still holds what it
 * extracted. This walks each survivor's source rows back to those duplicates.
 *
 * Both live paths now carry terms across on their own, so this is a repair of
 * what they already wrote, not a substitute for them.
 *
 *   npm run fix:terms -- --dry
 *   npm run fix:terms
 */

/** Sentences that deny terms exist. */
const DENIES_TERMS =
  /(no (financial |further |specific )?terms|terms (were|are) not|no dollar figures|terms were undisclosed|financial details were not)/i;

function reject(body: string, old: string): string | null {
  if (!body || body.length < 40) return "too short";
  if (body === old) return "unchanged";
  if (DENIES_TERMS.test(body)) return "still denies terms";
  if (/—/.test(body)) return "em dash";
  if (/\brelay(s|ed)?\b/i.test(body)) return "uses relay";
  if (/[\u0000-\u0008\u000B-\u001F]/.test(body)) return "control characters";
  if (/","\w+":|":\s*(null|")|\\u[0-9a-f]{4}|[{}]/i.test(body)) return "raw JSON in the text";
  if (body.length < old.length * 0.6) return "shorter than what it replaces";
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

  /*
   * Survivors missing terms, paired with any merged-away duplicate that has
   * them. The duplicates are reachable because the merge moved their feed
   * items onto the survivor as source rows.
   */
  const res = await db.execute(sql`
    select k.id, k.slug, k.body, k.contract_value, k.contract_years,
           d.contract_value as dupe_value, d.contract_years as dupe_years,
           d.slug as dupe_slug, d.body as dupe_body
      from rumors k
      join rumor_sources rs on rs.rumor_id = k.id
      join rumors d on d.feed_item_id = rs.feed_item_id and d.id <> k.id
     where k.is_published
       and (k.contract_value is null or k.contract_years is null)
       and (d.contract_value is not null or d.contract_years is not null)`);

  const rows = (res.rows ?? res) as Record<string, string | number | null>[];
  console.log(`${rows.length} posts whose merged sources carry terms they do not\n`);

  if (!dryRun && rows.length) {
    const file = `missing-terms-${Date.now()}.json`;
    writeFileSync(
      file,
      JSON.stringify(
        rows.map((r) => ({
          id: r.id,
          slug: r.slug,
          body: r.body,
          contractValue: r.contract_value,
          contractYears: r.contract_years,
        })),
        null,
        2,
      ),
    );
    console.log(`old values saved to ${file}\n`);
  }

  let fixed = 0;
  const skipped: string[] = [];

  for (const r of rows) {
    const value = (r.contract_value ?? r.dupe_value) as string | null;
    const years = (r.contract_years ?? r.dupe_years) as number | null;
    const body = String(r.body);

    /*
     * Only posts that DENY terms are touched.
     *
     * A duplicate's figure is not automatically this post's contract value.
     * "Klay Thompson left $9.8M behind to leave Dallas" stored $9.8M — the
     * money he gave up in a buyout, not what he signed for — and copying it
     * onto the buyout post would have printed it as the deal's worth. Where
     * the survivor never claimed terms were absent, there is no defect to
     * repair and no way to tell a contract figure from any other one.
     */
    if (!DENIES_TERMS.test(body)) {
      skipped.push(`${String(r.slug)}: says nothing about terms, left alone`);
      continue;
    }

    console.log(`— ${r.slug}`);
    console.log(`  terms: ${value ?? "—"} · ${years ?? "—"} yr  (from ${r.dupe_slug})`);

    if (!dryRun) {
      await db
        .update(rumors)
        .set({
          ...(value ? { contractValue: value.slice(0, 24) } : {}),
          ...(years ? { contractYears: years } : {}),
        })
        .where(eq(rumors.id, Number(r.id)));
    }

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
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
            `This post says the terms of a deal were not disclosed. They were: another outlet reporting the same move gave them.`,
            ``,
            `Terms: ${[value, years ? `${years} year${years > 1 ? "s" : ""}` : null].filter(Boolean).join(", ")}`,
            `The other outlet's summary: ${r.dupe_body ?? "(none)"}`,
            ``,
            `Current summary:`,
            body,
            ``,
            `Rewrite it so the terms are stated as part of the news, and remove the sentence saying they were not disclosed. Keep every other fact exactly as it is and add nothing else.`,
          ].join("\n"),
        },
      ],
    });

    const t = response.content.find((b) => b.type === "text");
    if (!t || t.type !== "text") {
      skipped.push(`${String(r.slug)}: no text block`);
      continue;
    }
    let parsed: { body: string };
    try {
      parsed = JSON.parse(t.text);
    } catch {
      skipped.push(`${String(r.slug)}: unparseable response`);
      continue;
    }

    const bad = reject(parsed.body, body);
    if (bad) {
      skipped.push(`${String(r.slug)}: ${bad}`);
      continue;
    }

    fixed++;
    console.log(`  OLD: ${body}`);
    console.log(`  NEW: ${parsed.body}\n`);
    if (!dryRun) {
      await db.update(rumors).set({ body: parsed.body }).where(eq(rumors.id, Number(r.id)));
    }
  }

  console.log(`${dryRun ? "would fix" : "fixed"} ${fixed} of ${rows.length}`);
  if (skipped.length) {
    console.log(`\nleft alone (${skipped.length}):`);
    for (const s of skipped) console.log(`  ${s}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
