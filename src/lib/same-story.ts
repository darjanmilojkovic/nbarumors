import Anthropic from "@anthropic-ai/sdk";

/**
 * Decide whether two reports are the same story.
 *
 * Event-key similarity cannot do this. Three reports on Nikola Jovic's trade
 * value, all Jake Fischer, all on 26 August, produced
 * "nikola-jovic-mia-trade-speculation",
 * "nikola-jovic-mia-dal-trade-talks-klay-thompson" and
 * "heat-jovic-portis-negative-value-trade-market" — 0.44, 0.20 and 0.15
 * against a 0.50 threshold. One angle names Klay Thompson and another names
 * Bobby Portis, so the strings diverge while the story does not.
 *
 * Lowering the threshold is not the answer either. The same relaxation that
 * unites those three also unites "LeBron James suitors ranked by who needs him
 * most" with "Winners and losers of LeBron's long free agency", which are two
 * columns about one player rather than two reports of one event.
 *
 * So the shape is: cheap rules find candidates, and this decides. It is only
 * reached when a post about the same player exists within two days and the
 * keys did NOT already match — a handful of times a day.
 */

/*
 * Opus 5.5, not the extraction model.
 *
 * Sonnet 5 at low effort was consistent (3 of 78 verdicts moved across three
 * runs, 29 Sep 2026) but too willing to say SAME: on clear pairs it merged a
 * ranking of unsigned free agents into Duren's own story, and Grill's
 * Exhibit 10 signing into his release two days later — six such errors in 30
 * days, hidden only because candidates then had to share a type label. Opus
 * 5.5 at low effort got all six right with the same prompt. It thinks before
 * answering, which is why max_tokens is 4,000 rather than 8. About half a cent
 * a call.
 */
const MODEL = process.env.SAME_STORY_MODEL ?? "claude-opus-5-5";
/*
 * Built on first use, not at import.
 *
 * A script loads its .env at the top of main(), but a static import is
 * evaluated before that line runs — so a client constructed at module scope
 * saw no ANTHROPIC_API_KEY and threw on every call. The catch below turned
 * that into a quiet "no", and a merge pass reported 31 pairs deliberately
 * kept apart when it had in fact never asked.
 */
let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

const SYSTEM = `You are deduplicating an NBA transfer wire.

Two reports are given. Answer whether they describe the SAME underlying event, meaning a reader would be ill served by seeing both as separate posts.

Same event: two outlets reporting one signing, trade, buyout or set of talks, even where each carries details the other lacks, names a different team in the discussions, or frames it around a different player in the same deal. A follow-up adding terms, a reaction to the same move, or a later report of talks already covered are all the same event.

DIFFERENT events: two separate transactions involving one player; a report about a player's contract and a report about a trade for him; two opinion or list pieces that happen to feature the same name; a move and an unrelated rumour from the same day; a piece weighing several options for a team ("Heat weigh Konchar, a Vincent reunion, or holding the spot open") and a report about just one of those options ("Konchar could land in Miami"); a player's own push or situation and a list of trade candidates that includes him; a signing and a later piece about the roster or salary math it left behind; a roundup covering several stories and a report on just one of them, even when that story leads the roundup; two reports giving conflicting accounts of where one deal stands (one says it is nearly done, the other that it is on hold), which stay apart until events show which was right. When a reader would reasonably want both, say different.

Answer with the word SAME or DIFFERENT and nothing else.`;

/** Never throws: on any failure the pair is treated as different, which leaves both posts standing. */
export async function sameStory(
  a: { headline: string; body: string },
  b: { headline: string; body: string },
): Promise<boolean> {
  try {
    const res = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low" },
      /*
       * No cache_control, deliberately: the prompt is a few hundred tokens,
       * below any model's minimum cacheable prefix. A marker here once read as
       * though caching were on while writing nothing — measured with
       * count_tokens on 30 Aug 2026.
       */
      system: [{ type: "text", text: SYSTEM }],
      messages: [
        {
          role: "user",
          content: [
            `REPORT A: ${a.headline}`,
            a.body,
            ``,
            `REPORT B: ${b.headline}`,
            b.body,
          ].join("\n"),
        },
      ],
    });
    if (res.stop_reason === "refusal") return false;
    const text = res.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join(" ");
    // The last verdict word, in case the answer restates the question.
    const verdict = [...text.matchAll(/\b(SAME|DIFFERENT)\b/gi)].pop()?.[1];
    if (!verdict) {
      console.warn(`  ! same-story check gave no verdict (${res.stop_reason})`);
      return false;
    }
    return verdict.toUpperCase() === "SAME";
  } catch (e) {
    /*
     * Failing closed is right — an unanswered question must leave both posts
     * standing — but failing SILENTLY is not. A first run of the retroactive
     * pass reported 31 pairs "kept apart" that were nothing of the sort: the
     * calls were being rate limited and every one of them returned false,
     * which is indistinguishable from a considered no unless it says so.
     */
    console.warn(`  ! same-story check failed: ${(e as Error).message.slice(0, 80)}`);
    return false;
  }
}
