import { config } from "dotenv";
config({ path: ".env.local" });
import { eq, sql } from "drizzle-orm";
import { writeFileSync } from "node:fs";

/**
 * Rewrite posts that open by naming the outlet the byline already shows.
 *
 * 39% of non-transaction posts began "Fadeaway World runs through...",
 * "Heavy.com has published...", "Yahoo Sports published..." — repeating, in
 * the first three words, the name printed directly above them as a link. A
 * few headlines did it too: "Yahoo floats Lakers three-team trade".
 *
 * The extraction prompt is fixed for new items; this brings the archive into
 * line. Only headline and body are touched — slug, event key, teams, players,
 * dates and status all stay put, so nothing that links to or depends on a post
 * can move.
 *
 * Every original is written to a JSON file before anything is updated, because
 * overwriting prose has no undo.
 *
 *   npm run fix:openings -- --dry --limit 8
 *   npm run fix:openings
 */
const IN_RATE = Number(process.env.PRICE_IN_PER_MTOK ?? 5);
const OUT_RATE = Number(process.env.PRICE_OUT_PER_MTOK ?? 25);

const SCHEMA = {
  type: "object",
  properties: {
    headline: {
      type: "string",
      description:
        "The headline, unchanged unless it names the outlet. If it does, rewrite only to remove that: 'Yahoo floats Lakers three-team trade' becomes 'Hypothetical three-team trade moves Knecht and Hardy out of LA'. Sentence case. Describe what is proposed without judging it — 'hypothetical' and 'proposed' are accurate, 'made-up' and 'fake' are not ours to say.",
    },
    body: {
      type: "string",
      description:
        "The same facts, rewritten so it does NOT open with the outlet's name — the card prints that directly above as a link. Lead with the substance: what would happen, to whom, on what terms. Attribution still belongs inside a sentence where a specific claim needs it, and a named reporter earns it more than a masthead. Speculation must stay obvious without leaning on the publisher's name: 'a proposed three-team deal would send...', 'projection rather than reporting, with no sourcing'. Keep every fact — invent nothing, drop nothing. Punchy and dry, no hype.",
    },
  },
  required: ["headline", "body"],
  additionalProperties: false,
} as const;

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
      publisher: feedItems.publisher,
      title: feedItems.title,
      rawSummary: feedItems.rawSummary,
    })
    .from(rumors)
    .leftJoin(feedItems, eq(feedItems.id, rumors.feedItemId))
    .leftJoin(sources, eq(sources.id, rumors.sourceId))
    .where(sql`${rumors.isPublished} and ${sources.slug} <> 'bbref-transactions'`)
    .orderBy(sql`${rumors.publishedAt} desc`);

  /*
   * The byline shows the publisher when there is one and the source otherwise,
   * so a post is redundant if it opens with either. Headlines count too.
   */
  const affected = rows.filter((r) => {
    const names = [r.publisher, r.outlet].filter(Boolean) as string[];
    const opensWith = names.some((n) =>
      r.body.slice(0, n.length + 2).toLowerCase().startsWith(n.toLowerCase()),
    );
    const inHeadline = names.some((n) =>
      new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(r.headline),
    );
    return opensWith || inHeadline;
  });

  const work = limit ? affected.slice(0, limit) : affected;
  console.log(`${rows.length} non-transaction posts · ${affected.length} name their own outlet · rewriting ${work.length}\n`);

  if (!dryRun) {
    const backup = `originals-${Date.now()}.json`;
    writeFileSync(backup, JSON.stringify(work, null, 2));
    console.log(`originals saved to ${backup}\n`);
  }

  /*
   * One rewrite in six came back corrupted — literal tabs and half-words:
   * "no reporter is credited \ttarios rather than sourcing \tios \tno sourcing
   * at all." Prose has no undo once written, so every result is checked before
   * it is allowed near the database.
   */
  /*
   * The model sometimes double-escapes a character inside the JSON string, so
   * parsing yields the six literal characters of "—" instead of an em
   * dash. Decoding is safe and lossless; rejecting the whole rewrite over one
   * punctuation mark would not be.
   */
  const decodeEscapes = (s: string) =>
    s.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );

  const reject = (text: string, original: string, names: string[]) => {
    const t = text.trim();
    if (/[\t\r\v\f]/.test(t)) return "control characters";
    if (!/[.!?]$/.test(t)) return "does not end in a full stop";
    if (t.length < original.length * 0.5) return "lost too much text";
    if (t.length > original.length * 1.6) return "grew implausibly";
    // The whole point: it must no longer open with the byline's name.
    if (names.some((n) => t.slice(0, n.length + 2).toLowerCase().startsWith(n.toLowerCase())))
      return "still opens with the outlet";
    // A stutter like "sourcing ... ios ... sourcing" is the corruption tell.
    const words = t.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
    if (words.length && new Set(words).size / words.length < 0.55) return "repetitive fragments";
    return null;
  };

  let inTok = 0, outTok = 0, changed = 0, rejected = 0;
  for (const r of work) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 700,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: `The byline above this post already reads "${r.publisher || r.outlet}".\n\nHeadline: ${r.headline}\nBody: ${r.body}\n\nOriginal item: ${r.title ?? ""} — ${r.rawSummary ?? ""}`,
      }],
    });
    inTok += res.usage.input_tokens;
    outTok += res.usage.output_tokens;
    if (res.stop_reason === "refusal") continue;
    const t = res.content.find((b) => b.type === "text");
    if (!t || t.type !== "text") continue;
    let out: { headline: string; body: string };
    try { out = JSON.parse(t.text); } catch { console.log(`  ! unparseable: ${r.slug}`); continue; }
    if (!out.body) continue;
    out.body = decodeEscapes(out.body);
    out.headline = decodeEscapes(out.headline ?? "");

    const names = [r.publisher, r.outlet].filter(Boolean) as string[];
    const problem = reject(out.body, r.body, names);
    if (problem) {
      rejected++;
      console.log(`  ✗ ${r.slug.slice(0, 46)} — ${problem}, left alone`);
      continue;
    }

    changed++;
    console.log(`— ${r.slug.slice(0, 54)}   [byline: ${r.publisher || r.outlet}]`);
    if (out.headline !== r.headline) console.log(`  HEAD  ${r.headline}\n     →  ${out.headline}`);
    console.log(`  OLD   ${r.body}`);
    console.log(`  NEW   ${out.body}\n`);
    if (!dryRun) {
      await db.update(rumors)
        .set({ headline: out.headline || r.headline, body: out.body })
        .where(eq(rumors.id, r.id));
    }
  }

  const cost = (inTok / 1e6) * IN_RATE + (outTok / 1e6) * OUT_RATE;
  console.log(`${dryRun ? "would rewrite" : "rewrote"} ${changed} of ${work.length} · rejected ${rejected}`);
  console.log(`tokens: ${inTok.toLocaleString()} in · ${outTok.toLocaleString()} out · $${cost.toFixed(4)}`);
  if (limit) console.log(`→ ~$${((cost / Math.max(work.length, 1)) * affected.length).toFixed(2)} for all ${affected.length}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
