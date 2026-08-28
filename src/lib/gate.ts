import Anthropic from "@anthropic-ai/sdk";

/**
 * A cheap screen in front of extraction.
 *
 * Every feed item used to reach Opus at about $0.0155, including MLB broadcast
 * listings and open threads wishing a player a happy birthday. Measured over
 * seven days, 605 of 1,461 items — 41% — were read in full and then rejected.
 *
 * Haiku answers the one question that separates them for roughly $0.0003, a
 * fiftieth of the price. Scored against those same seven days on two
 * independent samples of 600, it blocked 81% of what Opus rejected while
 * passing 99% of what Opus kept.
 *
 * The 1% it turns away wrongly is the reason for the rest of the design: this
 * fails OPEN on any error, and a blocked item is recorded with a reason rather
 * than dropped, so the mistakes are auditable instead of invisible.
 */
const client = new Anthropic();

/** Deliberately not the extraction model. The whole point is that it is cheap. */
const MODEL = process.env.GATE_MODEL ?? "claude-haiku-4-5";

/** Marks a rejection as the gate's rather than extraction's. */
export const GATE_REASON = "gate: not transfer news";

/*
 * Biased toward passing items through, because the two errors are not
 * symmetric: a false positive costs a fiftieth of a cent and extraction
 * rejects it anyway, while a false negative loses a story and says nothing.
 *
 * The foreign-signing clause is not decoration. Without it the screen turned
 * away "Bucks Second-Rounder Malique Lewis Signs With Cairns Taipans" and
 * "Sharife Cooper Signs With Liaoning Flying Leopards" — NBA players moving to
 * clubs abroad, which this site does cover.
 */
const SYSTEM = `You screen sports headlines for an NBA transfer-news site.

Answer "yes" if the item could be about an NBA player changing teams or contracts: a trade, a signing, free agency, a waiver, a buyout, a contract extension, the draft, or a rumor or report about any of those.

Answer "yes" for an NBA player, an NBA draftee or a former NBA player signing ANYWHERE, including clubs outside the NBA — Australia, China, Europe. The player is the subject, not the league.

Answer "no" only if it is clearly something else: a game recap or preview, a season outlook, a statistical or historical feature, injury news with no transfer angle, off-court or personal news, opinion and debate, or a story about another sport entirely. Also "no" for a move between two non-NBA clubs where nobody involved has an NBA connection.

When genuinely unsure, answer "yes". Reply with one word.`;

/**
 * Whether an item is worth an extraction call.
 *
 * Returns true on any failure. A screen that stops the pipeline when it breaks
 * is worse than no screen: the saving is about a dollar a day, and ingestion
 * is the product.
 */
export async function worthExtracting(item: {
  title: string;
  rawSummary: string | null;
}): Promise<boolean> {
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 5,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          // 200 characters is what the evaluation used; more did not help.
          content: `Headline: ${item.title}\nSummary: ${(item.rawSummary ?? "").slice(0, 200)}`,
        },
      ],
    });
    if (response.stop_reason === "refusal") return true;
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return true;
    return !block.text.trim().toLowerCase().startsWith("no");
  } catch {
    return true;
  }
}
