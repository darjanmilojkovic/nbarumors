import Anthropic from "@anthropic-ai/sdk";
import { SCHEMA } from "@/lib/extract";

/**
 * Grow a post's summary when a later report adds something to it.
 *
 * Until now a merge only ever removed: the second report became a line in the
 * corroboration chain and its content was thrown away. That is why matching
 * had to stay conservative — every collapse risked losing a fact, as the
 * DeRozan signing proved when "$3.9M" went into a duplicate and the surviving
 * post said no terms were disclosed.
 *
 * Three reports on one Nikola Jovic story carried the Dallas sweetener demand,
 * the Charlotte and Brooklyn scenarios and the $62.4M extension between them,
 * and no single post had all of it. A post that accumulates is both the better
 * read and what makes wider matching safe to attempt.
 */

/**
 * Sonnet, matching extraction — but through its own variable, because the two
 * jobs were compared and could reasonably diverge again.
 *
 * Both models were run over the same 103-character stub with the same prompt,
 * merging the same ten-outlet chain on the Josh Green trade. Neither won
 * cleanly, and the failure modes are different rather than one being better:
 *
 *   Sonnet invents precision. It said the trade cleared "roughly $10.6
 *   million" of space in one run and "$6.5M" in another, from identical
 *   input — contradicting itself on a dollar figure.
 *
 *   Opus loses detail. On the Dillon Brooks extension it dropped a fact the
 *   existing summary carried, his career-best 20.2 points per game, though
 *   the prompt says to keep every fact unless a later report corrects it.
 *
 * Opus also attributed more tightly and wrote drier prose; Sonnet read better.
 * Sonnet is the choice, so enrichment and extraction stay on one model.
 *
 * ENRICHMENT_MODEL exists so the split is one variable away if the figure
 * problem shows up in the wild — it is the more dangerous of the two, since a
 * missing detail is recoverable and a wrong number is published as truth.
 */
const MODEL = process.env.ENRICHMENT_MODEL ?? "claude-sonnet-5";
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

/** Hard cap, so a story followed for a week does not become an essay. */
const MAX_BODY_CHARS = 900;

/**
 * Borrowed vocabulary we have decided against, checked rather than asked for.
 *
 * The prompt tells every extraction to use the word a reader would use, and
 * mostly it does. This is the half that does not depend on that holding: a
 * rewrite carrying one of these is refused and the post keeps the summary it
 * already had, which is the safe direction to fail in.
 *
 * fix:jargon reads the same list, so adding a word here also sweeps the
 * archive for it.
 *
 * "in frame" earns its place for a different reason than "framework": it is
 * not borrowed from executives but from British sportswriting, where "in the
 * frame" means in contention. With the article dropped, on a US basketball
 * site, a headline saying two players are "in frame" tells a reader nothing.
 */
export const JARGON = ["framework", "in frame"];

const JARGON_RE = new RegExp(JARGON.join("|"), "i");

/**
 * Everything we have been told twice not to publish, in one place.
 *
 * The rewrite scripts each grew their own copy of this and they have already
 * drifted; anything running in the live pipeline uses this one.
 */
export function rejectBody(next: string, current: string): string | null {
  if (!next || next.length < 40) return "too short";
  if (next === current) return "unchanged";
  if (next.length > MAX_BODY_CHARS) return "over the length cap";
  if (next.length < current.length * 0.8) return "shorter than what it replaces";
  if (/—/.test(next)) return "em dash";
  if (/\brelay(s|ed)?\b/i.test(next)) return "uses relay";
  if (JARGON_RE.test(next)) return "uses jargon we have decided against";
  if (/[\u0000-\u0008\u000B-\u001F]/.test(next)) return "control characters";
  if (/","\w+":|":\s*(null|")|\\u[0-9a-f]{4}|[{}]/i.test(next)) return "raw JSON in the text";
  if (
    /(treat (it|this) as|projection rather than reporting|not a deal in motion|speculation (built on|until|rather than)|no reporter is credited)/i.test(
      next,
    )
  ) {
    return "comments on the sourcing";
  }
  const words = next.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length && new Set(words).size / words.length < 0.5) return "repetitive";
  return null;
}

/**
 * Does the incoming report carry anything the post does not already say?
 *
 * Cheap and deliberately literal: figures, capitalised names and team codes.
 * A second outlet restating the same three facts in different words is the
 * common case, and paying for a rewrite that changes nothing but the phrasing
 * would churn every post on the site for no reader benefit.
 */
export function addsSomething(current: string, incoming: string): boolean {
  const tokens = (s: string) =>
    new Set(
      (s.match(/\$[\d.]+[MBK]?|\b\d{4}\b|\b[A-Z][a-z]{2,}\b|\b[A-Z]{2,4}\b/g) ?? []).map((t) =>
        t.toLowerCase(),
      ),
    );
  const have = tokens(current);
  for (const t of tokens(incoming)) if (!have.has(t)) return true;
  return false;
}

/**
 * One summary covering both reports, or null to leave the post alone.
 *
 * Never throws: enrichment is an improvement on a post that already reads
 * correctly, so a failure here must cost detail and nothing else.
 */
export async function enrichBody(input: {
  headline: string;
  current: string;
  incoming: string;
  incomingOutlet: string;
}): Promise<string | null> {
  if (!addsSomething(input.current, input.incoming)) return null;

  try {
    const res = await anthropic().messages.create({
      model: MODEL,
      max_tokens: 900,
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
      system: [
        {
          type: "text",
          text: `You maintain a running summary of one NBA transfer story as more outlets report it.

You are given the summary as it stands and a newer report on the same story. Write ONE summary that covers both.

Keep every fact from the existing summary unless the new report corrects it, in which case the newer figure wins and you say it came in below or above what was first reported. Add what the new report contributes and nothing else — no facts from your own knowledge, no restating the same point in two ways because two outlets said it.

Attribute a specific claim to whoever made it when the reports disagree about who said what. Where they agree, one attribution is enough.

This is a summary, not a digest. If the new report adds one detail, the result is the old summary plus that detail, not a reorganisation of it.

Give every player a first name and a surname the first time they appear in the merged summary, even where the existing summary or the incoming report used the surname alone. Merging is where this goes wrong: two reports each name a different Williams, and the result reads as one man. After the first mention the surname alone is fine.

Place anyone who is not a player. A reporter, analyst, agent or executive is introduced with their outlet or their job the first time they appear: "ESPN's Bobby Marks", "agent Mike George", "Jazz general manager Justin Zanik". Merging is where this goes wrong too — the second report knows who its own analyst is and the merged text inherits the name without the introduction, so a reader meets "Bobby Marks notes the swap leaves Minnesota below the apron" with no idea whether that is a reporter, an executive or a player.

Marc Stein and Stephen A. Smith are the exceptions: the name is the credential, and placing them reads as condescension. Write those two plainly and place everyone else.`,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: [
            `Headline: ${input.headline}`,
            ``,
            `Summary as it stands:`,
            input.current,
            ``,
            `Newer report, from ${input.incomingOutlet}:`,
            input.incoming,
          ].join("\n"),
        },
      ],
    });

    if (res.stop_reason === "refusal") return null;
    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return null;

    const parsed = JSON.parse(text.text) as { body: string };
    return rejectBody(parsed.body, input.current) ? null : parsed.body;
  } catch {
    return null;
  }
}
