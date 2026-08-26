import Anthropic from "@anthropic-ai/sdk";
import { SCHEMA, type Extraction } from "@/lib/extract";

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

const MODEL = process.env.EXTRACTION_MODEL ?? "claude-opus-5";
const client = new Anthropic();

/** Hard cap, so a story followed for a week does not become an essay. */
const MAX_BODY_CHARS = 900;

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
  incoming: Extraction;
  incomingOutlet: string;
}): Promise<string | null> {
  if (!addsSomething(input.current, input.incoming.body)) return null;

  try {
    const res = await client.messages.create({
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

This is a summary, not a digest. If the new report adds one detail, the result is the old summary plus that detail, not a reorganisation of it.`,
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
            input.incoming.body,
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
