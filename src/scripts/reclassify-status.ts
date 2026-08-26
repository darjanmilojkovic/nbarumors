import { config } from "dotenv";
config({ path: ".env.local" });
import { eq, sql } from "drizzle-orm";

/**
 * Re-classify posts whose status was decided under the old rules.
 *
 * The enum used to be graded by how authoritative the source was — "a named
 * insider reports it" ranked below "the move is done" — so a deal that had
 * plainly been agreed came out as `reported` whenever it arrived through a
 * journalist. James Harden's $97M extension, announced by his own agency, sat
 * on "Developing" beside two-way contracts marked "Done deal".
 *
 * The enum now describes the state of the deal instead. This asks the same
 * question of the posts already written, reading the ORIGINAL wire text rather
 * than our summary, and writes nothing but a status.
 *
 *   npm run fix:status -- --dry    review every change
 *   npm run fix:status             apply
 */
const IN_RATE = Number(process.env.PRICE_IN_PER_MTOK ?? 5);
const OUT_RATE = Number(process.env.PRICE_OUT_PER_MTOK ?? 25);

async function main() {
  const dryRun = process.argv.includes("--dry");
  const { db } = await import("@/db");
  const { rumors, feedItems } = await import("@/db/schema");
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic();
  const MODEL = process.env.EXTRACTION_MODEL ?? "claude-opus-5";

  /*
   * Only the two statuses the old wording could get wrong. Anything already
   * `completed` came from the official transaction log, and re-asking would
   * risk demoting a fact.
   */
  const candidates = await db
    .select({
      id: rumors.id,
      slug: rumors.slug,
      headline: rumors.headline,
      body: rumors.body,
      status: rumors.status,
      title: feedItems.title,
      rawSummary: feedItems.rawSummary,
    })
    .from(rumors)
    .leftJoin(feedItems, eq(feedItems.id, rumors.feedItemId))
    .where(sql`${rumors.isPublished} and ${rumors.status} in ('rumor','reported')`)
    .orderBy(sql`${rumors.publishedAt} desc`);

  console.log(`${candidates.length} posts to re-examine\n`);

  const SCHEMA = {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["rumor", "reported", "confirmed", "completed", "debunked"],
        description:
          "How far along the DEAL is, not how authoritative the source is. completed = an agreement has been reached: the item says the player agreed to terms, is signing, has signed, was traded, was waived or was bought out — whether or not the league has processed it and whether or not a team has issued a release. An agent telling a reporter that terms are agreed is a completed deal. confirmed = a team or the player has publicly announced it. reported = an insider says a deal is close, likely, being negotiated or expected, but not yet agreed. rumor = speculation, interest, 'linked with', nothing agreed. debunked = denied. Never downgrade an agreed deal merely because it reached you through a journalist.",
      },
      evidence: {
        type: "string",
        description: "The few words from the item that decide it.",
      },
    },
    required: ["status", "evidence"],
    additionalProperties: false,
  } as const;

  let inTokens = 0;
  let outTokens = 0;
  const changes: Record<string, number> = {};

  for (const c of candidates) {
    const source = c.title
      ? `Headline: ${c.title}\nSummary: ${c.rawSummary ?? "(none)"}`
      : `Headline: ${c.headline}\nSummary: ${c.body}`;

    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: SCHEMA },
      },
      messages: [{ role: "user", content: `How far along is this NBA deal?\n\n${source}` }],
    });

    inTokens += res.usage.input_tokens;
    outTokens += res.usage.output_tokens;
    if (res.stop_reason === "refusal") continue;
    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") continue;
    /*
     * One item in ninety came back as malformed JSON and took the whole run
     * down with it, after it had already written some rows. A single bad
     * response is not a reason to abandon the other eighty-nine.
     */
    type Status = "rumor" | "reported" | "confirmed" | "completed" | "debunked";
    let parsed: { status: Status; evidence: string };
    try {
      parsed = JSON.parse(text.text);
    } catch {
      console.log(`  ! unparseable response for ${c.slug} — skipped`);
      continue;
    }
    const { status, evidence } = parsed;
    if (status === c.status) continue;

    const move = `${c.status} → ${status}`;
    changes[move] = (changes[move] ?? 0) + 1;
    console.log(`  ${move.padEnd(24)} ${c.headline.slice(0, 52)}\n      "${evidence}"`);
    if (!dryRun) {
      await db.update(rumors).set({ status }).where(eq(rumors.id, c.id));
    }
  }

  const cost = (inTokens / 1e6) * IN_RATE + (outTokens / 1e6) * OUT_RATE;
  console.log(`\n${dryRun ? "would change" : "changed"}:`);
  for (const [k, v] of Object.entries(changes).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(24)} ${v}`);
  }
  console.log(
    `\ntokens: ${inTokens.toLocaleString()} in · ${outTokens.toLocaleString()} out` +
      `\ncost at ${IN_RATE}/${OUT_RATE} per Mtok: $${cost.toFixed(4)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
