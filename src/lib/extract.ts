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
  players: {
    name: string;
    isPrimary: boolean;
    fromTeam: string | null;
    toTeam: string | null;
  }[];
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
/*
 * Exported so the archive rewrite can reuse the exact body rules rather than
 * paraphrasing them into a second prompt that then drifts out of step.
 */
export const SCHEMA = {
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
        "An original headline in your own words, under 80 characters. Do NOT copy the source headline. Never begin with a wire label such as 'Report:', 'Rumor:', 'Update:', 'Breaking:' or 'Sources:' — every item here reports someone else's work and the byline already names the outlet. For the same reason, do not name the outlet in the headline either — 'Yahoo floats Lakers three-team trade' should be 'Three-team deal would send Knecht and Hardy out of LA'. That is the only change the byline forces: otherwise write the headline you would have written anyway. Describe what is being proposed without passing judgement on it — 'hypothetical' and 'proposed' are accurate, 'made-up' and 'fake' are us calling another outlet's work fabricated.\n\nSTART WITH THE SUBSTANCE, and never with the words 'Hypothetical', 'Proposed', 'Speculative' or 'Mock'. Three of these in a row down one team page read 'Hypothetical swap sends Durant to Boston', 'Hypothetical trade sends Lillard to Boston', 'Hypothetical trade sends Kyrie Irving back to Boston' — the same word three times before any of them says anything. The card already prints a Trade rumor kicker and a Developing badge beside the headline, so the label is the third time a reader is told. Put the players and the teams first and let the verb carry the conditional: 'Durant to Boston floated for a Derrick White package', 'Lillard would land in Boston for Hauser and Scheierman'. Use SENTENCE CASE: capitalise the first word and proper nouns only — people, teams, cities, outlets, competitions. Everything else stays lowercase. Write 'Harden stays in Cleveland on $97M deal', never 'Harden Stays In Cleveland On $97M Deal'.",
    },
    body: {
      type: "string",
      description:
        "One to four original sentences summarizing the reported facts, in your own words — as many as the available facts justify and no more. LENGTH FOLLOWS SUBSTANCE: a headline-only item with a single fact in it deserves a single sentence. Do not reach a sentence count by adding caveats; an honest one-liner beats three sentences padded out with what the item does not contain. Never copy phrasing from the source. Vary the wording; do not open every item the same way. Nineteen summaries in a row began ''A proposed framework would...'' or ''A hypothetical deal would...'', which reads as a template rather than a report — open with the player, the team, the reporter or the figure instead, and reach the conditional verb in the middle of the sentence. PUNCTUATION: no em dashes. Use a comma, a colon or a full stop instead; an em dash in a two-sentence sports summary reads as an affectation. And never write that an outlet 'relays' or 'relayed' something — the verbs are reports, reported, said, according to.\n\nDO NOT OPEN WITH THE OUTLET'S NAME. The card already prints it directly above, as a link, so 'Fadeaway World runs through...', 'Heavy.com has published...' and 'Yahoo Sports published...' all repeat what the reader can see. Lead with the substance instead — what would happen, to whom, on what terms.\n\nAttribution still belongs in the sentence where a specific claim needs it, and a named reporter earns it more than a masthead: 'Shams Charania reports', 'per ESPN'. When the item is an official league transaction record, say so plainly and vary it: 'the move is now official', 'it is on the league transaction log'. Never write 'according to sources' unless the source item itself credits sources — we aggregate public reporting and have none of our own.\n\nSPEND THE WORDS ON THE SPECULATION ITSELF, NOT ON DISCLAIMING IT. Which teams, which players, what the package is, what the argument for it is, any figures given — that is what a reader came for. Carry the fact that it is unconfirmed in the verbs, where it costs nothing: 'would send', 'is floated as', 'one proposed deal has', 'is predicted to'. A conditional verb already tells the reader this has not happened.\n\nNEVER WRITE A SENTENCE ABOUT THE SOURCING. Not 'Treat it as speculation', not 'This is a media projection rather than reporting', not 'No reporter is credited', not 'Nothing is agreed', not 'speculation from one insider, not a deal in motion', not 'Just interest'. The card prints a status badge — Rumor, Developing, Done Deal — immediately beside the summary, so a sentence saying the same thing spends a quarter of the post telling the reader what is already on screen. It also reads as sneering at the outlet we are citing. At most, ONE short clause inside a sentence that is carrying real information: 'floated with no sourcing attached'. Never a sentence of its own.\n\nPREFER THE CONCRETE. The mechanism (sign-and-trade, qualifying offer, team option, trade exception), the figures, the other teams in the running, who said it and where they said it — 'on a Bleacher Report live stream', 'on his podcast'. If the item hands you two facts, give the reader both.\n\nMANY ITEMS ARE A HEADLINE AND NOTHING ELSE. When that is all you have, write the one sentence the headline supports and stop. One accurate sentence is a good summary. Do not reach for a second or third by describing what the item does not contain.",
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
          fromTeam: {
            type: ["string", "null"],
            description:
              "The team abbreviation THIS player is leaving, or null if the item does not say. Fill it in whenever the item moves more than one player, so each player's direction is recorded separately: in a three-team proposal sending Jimmy Butler from Golden State to Atlanta and Jonathan Kuminga from Golden State to Milwaukee, both players get fromTeam GSW while their toTeam differs. Null for a player who is only mentioned and is not moving.",
          },
          toTeam: {
            type: ["string", "null"],
            description:
              "The team abbreviation THIS player is joining, or null if the item does not say. See fromTeam.",
          },
        },
        required: ["name", "isPrimary", "fromTeam", "toTeam"],
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
- You may close with one line of perspective, but it must ADD something, and it may only draw on facts stated in THIS item. Commentary on the shape of the deal is fine — that it is short, cheap, long, sudden. Commentary on the shape of the reporting is not: how thin the sourcing is, whether anyone is named, whether anything is agreed. That is the badge's job, and coming from us it reads as a sneer at the outlet we are citing. Do not mirror the source's own weariness back at the reader either — an item that opens "another day, another Kuminga update" is not licence to write "still no signing". Anything you happen to know from elsewhere is not: no nicknames or reputations ("the pest"), no playing-style or role assessments ("bench scoring"), no career-pattern claims ("another one-year deal"), no cap or roster consequences. If the item gives you nothing to say, end after the facts — a missing closing line is always better than an unsourced one.
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
