import Anthropic from "@anthropic-ai/sdk";
import { SEED_TEAMS } from "@/db/seed-data/teams";

/**
 * Default to Opus 5. Override with EXTRACTION_MODEL in .env.local to trade
 * quality for cost — this is the single biggest lever on the monthly bill.
 */
const MODEL = process.env.EXTRACTION_MODEL ?? "claude-opus-5";

export type Extraction = {
  isRumor: boolean;
  rejectedReason: string | null;
  type:
    | "trade"
    | "signing"
    | "free_agency"
    | "buyout"
    | "extension"
    | "waiver"
    | "draft"
    | "injury_impact"
    | "other";
  status: "rumor" | "reported" | "confirmed" | "completed" | "debunked";
  confidence: number;
  eventKey: string;
  contractValue: string | null;
  contractYears: number | null;
  headline: string;
  body: string;
  reportedBy: string | null;
  players: { name: string; isPrimary: boolean }[];
  teams: { abbreviation: string; role: "to" | "from" | "mentioned" }[];
};

const TEAM_LIST = SEED_TEAMS.map(
  (t) => `${t.abbreviation}=${t.city} ${t.name}`,
).join(", ");

/**
 * The schema is the contract. `strict`-style JSON schema output means we never
 * parse freeform prose, and the enums keep `type`/`status` aligned with the
 * Postgres enums without a translation layer.
 */
const SCHEMA = {
  type: "object",
  properties: {
    isRumor: {
      type: "boolean",
      description:
        "True only if this item REPORTS a transfer, trade, signing, contract, buyout, waiver or draft move — that is, it tells the reader something about the move they could not have known yesterday. False for game recaps, standings, injuries with no transfer angle, off-court news, awards and opinion pieces. Also false for a feature, column, retrospective, season preview, roster breakdown or ranking that merely REFERENCES a move already made: 'Eight years after Brett Brown went star hunting, the one he really wanted lands in Philly' is a profile of a coach, not a report that LeBron signed. The test is whether the move itself is the news. A feature CAN qualify if it carries something new about the move — a player explaining why he chose a team, or terms not previously reported — but not if the transfer is only its backdrop.",
    },
    rejectedReason: {
      type: ["string", "null"],
      description: "If isRumor is false, a short reason. Otherwise null.",
    },
    type: {
      type: "string",
      enum: [
        "trade",
        "signing",
        "free_agency",
        "buyout",
        "extension",
        "waiver",
        "draft",
        "injury_impact",
        "other",
      ],
    },
    status: {
      type: "string",
      enum: ["rumor", "reported", "confirmed", "completed", "debunked"],
      description:
        "How far along the DEAL is, not how authoritative the source is. completed = an agreement has been reached: the item says the player agreed to terms, is signing, has signed, was traded, was waived or was bought out — whether or not the league has processed it and whether or not a team has issued a release. An agent telling a reporter that terms are agreed is a completed deal. confirmed = a team or the player has publicly announced it. reported = an insider says a deal is close, likely, being negotiated or expected, but not yet agreed. rumor = speculation, interest, 'linked with', 'could pursue', nothing agreed. debunked = denied. Never downgrade an agreed deal to 'reported' merely because it reached you through a journalist — almost everything here does.",
    },
    confidence: {
      type: "number",
      description: "0-1 confidence that this is a real, on-topic transfer story.",
    },
    eventKey: {
      type: "string",
      description:
        "A canonical lowercase-hyphenated key identifying the SPECIFIC underlying event, so that separate outlets reporting the same event produce an identical key. Format: player-team-action-detail. Include the defining numbers when known (years, dollars). Examples: 'dillon-brooks-phx-extension-3yr-73m', 'lonnie-walker-den-signing-1yr'. CRITICAL: two stories about the same player are only the same event if they describe the same transaction. Distinct angles on one player's situation get distinct keys, e.g. 'lebron-suitors-ranked' vs 'lebron-gsw-interest-denied' vs 'lebron-phi-signing'.",
    },
    contractValue: {
      type: ["string", "null"],
      description:
        "Total contract value ONLY if the report states one, normalized as a short string like '$73M' or '$3.3M'. Null when no figure is given. Never estimate or infer a number.",
    },
    contractYears: {
      type: ["integer", "null"],
      description:
        "Contract length in years ONLY if stated. Null otherwise. Never estimate.",
    },
    headline: {
      type: "string",
      description:
        "An original headline in your own words, under 80 characters. Do NOT copy the source headline. Never begin with a wire label such as 'Report:', 'Rumor:', 'Update:', 'Breaking:' or 'Sources:' — every item here reports someone else's work and the byline already names the outlet. Start with the substance. Use SENTENCE CASE: capitalise the first word and proper nouns only — people, teams, cities, outlets, competitions. Everything else stays lowercase. Write 'Harden stays in Cleveland on $97M deal', never 'Harden Stays In Cleveland On $97M Deal'.",
    },
    body: {
      type: "string",
      description:
        "2-4 original sentences summarizing the reported facts, in your own words. Never copy phrasing from the source. Attribute claims, e.g. 'according to ESPN'. State plainly if it is speculation.",
    },
    reportedBy: {
      type: ["string", "null"],
      description:
        "The reporter credited in the source, e.g. 'Shams Charania'. Null if none named.",
    },
    players: {
      type: "array",
      description: "NBA players involved. Use full, correctly spelled names.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          isPrimary: {
            type: "boolean",
            description: "True for the player the move is actually about.",
          },
        },
        required: ["name", "isPrimary"],
        additionalProperties: false,
      },
    },
    teams: {
      type: "array",
      description: `Teams involved, by abbreviation. Valid: ${TEAM_LIST}`,
      items: {
        type: "object",
        properties: {
          abbreviation: { type: "string" },
          role: {
            type: "string",
            enum: ["to", "from", "mentioned"],
            description:
              "to = the team the player is joining or being acquired by. from = the team the player is leaving, for ANY reason — traded away, waived, bought out, cleared waivers from, or simply the team they played for last season before signing elsewhere. Record 'from' on signings, buyouts and waivers, not only on trades: if the item says a player signed with Miami after a Dallas buyout, Dallas is 'from' and Miami is 'to'. mentioned = a team otherwise involved, such as a rival also pursuing the player. Only omit 'from' when the item genuinely gives no indication of where the player is coming from.",
          },
        },
        required: ["abbreviation", "role"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "isRumor",
    "rejectedReason",
    "type",
    "status",
    "confidence",
    "eventKey",
    "contractValue",
    "contractYears",
    "headline",
    "body",
    "reportedBy",
    "players",
    "teams",
  ],
  additionalProperties: false,
} as const;

/**
 * Stable across every request, so it caches. Volatile per-item content goes in
 * the user turn, after the cache breakpoint.
 */
const SYSTEM = `You extract NBA transfer news for nbarumors.cc.

You are given the headline and summary of a news item from a sports feed. Your job:

1. Decide whether it is about a player transfer, trade, signing, contract, buyout, waiver, or draft move. Most items are not — game recaps, standings, awards, off-court news, and pure injury reports are all rejected.
2. If it is, extract the structured facts and write an ORIGINAL headline and 2-4 sentence summary.

Rules for the text you write:
- Write in your own words. Never reuse the source's phrasing or sentence structure. The source text is copyrighted; you are reporting the underlying facts, which are not.
- Attribute reported claims to the outlet or reporter.
- Do not overstate certainty. If a move is speculation, say so.
- No hype, no invented details. If the source does not say it, it does not go in.

VOICE — punchy and irreverent:
- Short sentences. Lead with what matters and skip the throat-clearing; no "in a move that will surely" wind-ups.
- Dry wit is welcome. Corniness, exclamation marks and puns on player names are not.
- You may close with one line of perspective, but it may only draw on facts stated in THIS item. Commentary on the shape of what was reported is fine — that a deal is short, cheap, long, sudden, or that a story is thin on sourcing. Anything you happen to know from elsewhere is not: no nicknames or reputations ("the pest"), no playing-style or role assessments ("bench scoring"), no career-pattern claims ("another one-year deal"), no cap or roster consequences. If the item gives you nothing to say, end after the facts — a missing closing line is always better than an unsourced one.
- Never assert what a team, player or agent has or has not confirmed, denied or announced unless the source says so explicitly. Absence of a statement in the source is not evidence that no statement exists.
- Never invent scouting takes, salary-cap consequences, locker-room dynamics or a player's reputation as if they were reported facts.
- The skepticism, when a story is thin, belongs in plain description — "this is speculation, with no named sourcing" — not in sneering at the player.

Valid team abbreviations: ${TEAM_LIST}`;

const client = new Anthropic();

export async function extractRumor(item: {
  title: string;
  rawSummary: string | null;
  publisher: string | null;
  sourceName: string;
}): Promise<Extraction> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SCHEMA },
    },
    system: [
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
    ],
    messages: [
      {
        role: "user",
        content: [
          `Outlet: ${item.publisher ?? item.sourceName}`,
          `Headline: ${item.title}`,
          `Summary: ${item.rawSummary ?? "(none provided)"}`,
        ].join("\n"),
      },
    ],
  });

  // Safety classifiers can decline; check before reading content.
  if (response.stop_reason === "refusal") {
    throw new Error("model declined to process this item");
  }

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error(`no text block in response (stop: ${response.stop_reason})`);
  }
  return JSON.parse(text.text) as Extraction;
}

export const extractionModel = () => MODEL;
