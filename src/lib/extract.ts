import Anthropic from "@anthropic-ai/sdk";
import { SEED_TEAMS } from "@/db/seed-data/teams";

/**
 * One model for every item. Override with EXTRACTION_MODEL in .env.local or in
 * the Vercel project — the single biggest lever on the monthly bill.
 *
 * On Sonnet 5 from 29 Aug 2026, on trial. After the Haiku gate stopped the
 * junk, about 198 items a day still reach this call: $3.07 on Opus against
 * $1.23 on Sonnet.
 *
 * The comment here used to say Sonnet did not honour the paragraph-break rule.
 * That was one observation from a small bake-off, recorded once and never
 * re-checked, and it was wrong. Run head to head on the same six articles both
 * models broke all three of their three-plus-sentence bodies into paragraphs,
 * agreed on every classification, and wrote near-identical headlines.
 *
 * This also routed by input length for a while, on the theory that Opus only
 * pulls ahead where there is a long article to mine. `npm run compare:models`
 * on items that actually became posts does not support it: across 400-char
 * teasers and 3,000-char articles alike the two land in the same place, and
 * where they differ it does not track length.
 *
 * What is still genuinely open is style rather than capability: Sonnet packs
 * slightly more fact into a body, and once reached for "floated", a word this
 * site avoids. Both show up in a day of output, which is what the trial is for.
 */
const MODEL = process.env.EXTRACTION_MODEL ?? "claude-sonnet-5";

export function modelFor(): string {
  return MODEL;
}

/**
 * Turn a leftover \uXXXX sequence back into the character it names.
 *
 * JSON.parse already handles escapes, so nothing should reach this. But the
 * model occasionally emits the escape doubled — \\u00f3 rather than ó —
 * and parsing that correctly yields six literal characters instead of "ó".
 * One post in 688 shipped reading "Vaqueros de Bayamón"; the source it was
 * written from had the accent intact, so this was our own output, not theirs.
 *
 * Applied only to the headline and body, the two fields a reader sees. A story
 * that genuinely wanted to print an escape sequence would be mangled by this,
 * which is not a trade worth worrying about on a basketball wire.
 */
export function decodeStrayEscapes(text: string): string {
  const pattern = new RegExp(
    `${String.fromCharCode(92, 92)}u([0-9a-fA-F]{4})`,
    "g",
  );
  return text.replace(pattern, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

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
  isRoundup: boolean;
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
        "True only if this item REPORTS a transfer, trade, signing, contract, buyout, waiver or draft move — that is, it tells the reader something about the move they could not have known yesterday. False for game recaps, standings, injuries with no transfer angle, off-court news, awards and opinion pieces. Also false for a feature, column, retrospective, season preview, roster breakdown or ranking that merely REFERENCES a move already made: 'Eight years after Brett Brown went star hunting, the one he really wanted lands in Philly' is a profile of a coach, not a report that LeBron signed. The test is whether the move itself is the news. A feature CAN qualify if it carries something new about the move — a player explaining why he chose a team, or terms not previously reported — but not if the transfer is only its backdrop.\n\nTHE MOVE MUST TOUCH THE NBA. False when both clubs are outside the NBA, however big the name: a former NBA player transferring between European clubs, released by one, or having a contract terminated by one is European basketball, not NBA transfer news. 'Partizan building without Jabari Parker as both sides seek exit' involves a Serbian club, a Spanish club and a Serbian newspaper, and reached the site as a buyout — the player having once played in the NBA is not an NBA angle.\n\nTrue when an NBA club is on either side, which includes a player still under NBA contract or whose draft rights an NBA team holds signing abroad, and a player leaving a foreign club FOR the NBA or leaving the NBA for one. Say which in rejectedReason so the decision is auditable: 'both clubs outside the NBA'.",
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
    isRoundup: {
      type: "boolean",
      description:
        "True when the item is a SURVEY of several unrelated situations rather than one story: a rumor roundup, a mailbag, a tracker, a list of trade candidates or free agents still available, a set of offseason grades. The test is whether the parts would stand as separate posts — 'Harden, Green among names left as free agency rolls on' covers two unconnected situations and is a roundup; 'Kuminga picks Minnesota, Mathurin heads to New Orleans' reports one transaction that moves two players and is NOT a roundup, however many names it carries. A multi-player trade, a three-team deal and a signing with knock-on moves are all single stories. False for anything reporting one move, one negotiation or one player's situation.",
    },
    headline: {
      type: "string",
      description:
        "An original headline in your own words, under 80 characters. Do NOT copy the source headline. Never begin with a wire label such as 'Report:', 'Rumor:', 'Update:', 'Breaking:' or 'Sources:' — every item here reports someone else's work and the byline already names the outlet. For the same reason, do not name the outlet in the headline either — 'Yahoo floats Lakers three-team trade' should be 'Three-team deal would send Knecht and Hardy out of LA'. That is the only change the byline forces: otherwise write the headline you would have written anyway. Describe what is being proposed without passing judgement on it — 'hypothetical' and 'proposed' are accurate, 'made-up' and 'fake' are us calling another outlet's work fabricated.\n\nSTART WITH THE SUBSTANCE, and never with the words 'Hypothetical', 'Proposed', 'Speculative' or 'Mock'. Three of these in a row down one team page read 'Hypothetical swap sends Durant to Boston', 'Hypothetical trade sends Lillard to Boston', 'Hypothetical trade sends Kyrie Irving back to Boston' — the same word three times before any of them says anything. The card already prints a Trade rumor kicker and a Developing badge beside the headline, so the label is the third time a reader is told. Put the players and the teams first and carry the conditional however the sentence wants it. VARY IT: naming two example verbs here once produced nine headlines saying 'would land' and fourteen saying 'floated', which reads as a house formula rather than a choice. A conditional verb, a clause, a colon, naming who is doing the proposing, or the shape of the package itself all work — 'Durant to Boston pitched for a Derrick White package', 'Sheppard and Thompson rank among the most valuable trade chips', 'Westbrook, Oladipo named as Kings options at point guard'. Use SENTENCE CASE: capitalise the first word and proper nouns only — people, teams, cities, outlets, competitions. Everything else stays lowercase. Write 'Harden stays in Cleveland on $97M deal', never 'Harden Stays In Cleveland On $97M Deal'. Basketball shorthand keeps its own capitals inside sentence case: it is '3-and-D', never '3-and-d'.\n\nNAME EVERYONE IN A LIST THE SAME WAY. When two or more players are listed as equals — joined by commas or 'and', all doing the same job in the sentence — every one of them takes the same form. All surnames, or all full names, never a mix. 'Sims, Jalen Smith, Hunter and Kuzma listed as Lakers fallbacks' changes gear mid-list for no reason a reader can see; 'Sims, Smith, Hunter and Kuzma' is right, and so is naming all four in full if they fit. Pick whichever form fits under 80 characters — with four names that usually means surnames, with two it often means full names.\n\nThis applies ONLY inside a list of equals. A full name for the player the move is about and surnames for everyone else is correct and should stay: 'Hawks ship Trae Young to Washington for Kispert, McCollum' and 'Josh Green heads to Utah as Williams and Konchar go to Minnesota' are both right, because Young and Green are the subject and the others are the return.\n\nA HEADLINE MAY USE AN AMBIGUOUS SURNAME. There are eight Smiths and half a dozen Greens, but the summary sits directly beneath the headline and names every player in full in its first sentence, so 'Smith' resolves within a line. Do not expand one name in a list to disambiguate it — that is what produced the mixed list above. This is a deliberate exception to the full-name rule for summaries, which have no such line beneath them.\n\nDO NOT REACH FIRST FOR 'EYE'. 'Lakers eye Sims', 'Cavs eye Diop', 'Warriors eye Murphy', 'Oladipo eyes NBA return' — four of those ran in the live feed inside one day, and read together they sound like a house tic rather than four separate reports. The word is not banned and it is the right one now and then, but it should never be the first verb you try. A team that is interested considers, targets, weighs, pursues, turns to, is in the market for, or is linked to. Better still, drop the verb of interest and use the specific fact instead: 'Diop is the frontrunner for Cleveland's last roster spot' says more than 'Cavs eye Diop', and 'Lakers turn to Sims and Smith after Kuminga picks Minnesota' says more than either.",
    },
    body: {
      type: "string",
      description:
        "One to six original sentences summarizing the reported facts, in your own words — as many as the available facts justify and no more. LENGTH FOLLOWS SUBSTANCE: a headline-only item with a single fact in it deserves a single sentence. Do not reach a sentence count by adding caveats; an honest one-liner beats three sentences padded out with what the item does not contain. Never copy phrasing from the source. Vary the wording; do not open every item the same way. Nineteen summaries in a row began ''A proposed framework would...'' or ''A hypothetical deal would...'', which reads as a template rather than a report — open with the player, the team, the reporter or the figure instead, and reach the conditional verb in the middle of the sentence. PUNCTUATION: no em dashes. Use a comma, a colon or a full stop instead; an em dash in a two-sentence sports summary reads as an affectation. And never write that an outlet 'relays' or 'relayed' something — the verbs are reports, reported, said, according to.\n\nDO NOT OPEN WITH THE OUTLET'S NAME. The card already prints it directly above, as a link, so 'Fadeaway World runs through...', 'Heavy.com has published...' and 'Yahoo Sports published...' all repeat what the reader can see. Lead with the substance instead — what would happen, to whom, on what terms.\n\nNEVER ATTRIBUTE ANYTHING TO THE OUTLET NAMED ABOVE AS 'Outlet:'. Not at the opening and not anywhere else in the summary. 'Miami's 15th roster spot has three paths, per Heavy' is a Heavy item, so the card already says Heavy directly above the sentence; the words buy nothing and read as though we were citing someone else. Drop the clause and the sentence is finished: 'Miami's 15th roster spot has three paths'. Same for 'according to RealGM' on a RealGM item and 'CBS Sports reports' on a CBS Sports item. THE TWO THAT KEEP GETTING THROUGH SIT MID-SENTENCE, WHICH IS WHY THEY ARE WORTH NAMING: 'A hypothetical framework floated by Heavy would send Brook Lopez...' and '...four draft picks, including a lottery-protected first-rounder, according to Heavy.' Both are Heavy items. Delete the credit and neither sentence loses anything: 'A trade idea would send Brook Lopez...' and '...including a lottery-protected first-rounder.' This happens most when the item names nobody else, and an aggregator with no reporter to credit is not a reason to credit yourself - it is a reason to carry it in the verb and stop. If a claim is in the item, it is what that outlet is reporting — that is the whole premise of the page.\n\nAttribution belongs in the sentence when the source is SOMEONE ELSE: a reporter the item quotes, or a different outlet it is citing. Those the reader cannot otherwise place, and they earn their words. On a Heavy item that cites two other outlets, 'the Heat once had trade interest in Konchar, per ClutchPoints' Brett Siegel' and 'bring back Gabe Vincent, per the Miami Herald's Barry Jackson' are both right, while a third 'per Heavy' on the same sentence is the one to cut. A named reporter earns it more than a masthead: prefer 'Shams Charania reports' to 'per ESPN'. When the item is an official league transaction record, say so plainly and vary it: 'the move is now official', 'it is on the league transaction log'. Never write 'according to sources' unless the source item itself credits sources — we aggregate public reporting and have none of our own.\n\nSPEND THE WORDS ON THE SPECULATION ITSELF, NOT ON DISCLAIMING IT. Which teams, which players, what the package is, what the argument for it is, any figures given — that is what a reader came for. Carry the fact that it is unconfirmed in the verbs, where it costs nothing: 'would send', 'is floated as', 'one proposed deal has', 'is predicted to'. A conditional verb already tells the reader this has not happened.\n\nNEVER WRITE A SENTENCE ABOUT THE SOURCING. Not 'Treat it as speculation', not 'This is a media projection rather than reporting', not 'No reporter is credited', not 'Nothing is agreed', not 'speculation from one insider, not a deal in motion', not 'Just interest'. The card prints a status badge — Rumor, Developing, Done Deal — immediately beside the summary, so a sentence saying the same thing spends a quarter of the post telling the reader what is already on screen. It also reads as sneering at the outlet we are citing. At most, ONE short clause inside a sentence that is carrying real information: 'floated with no sourcing attached'. Never a sentence of its own.\n\nNEVER WRITE A DOMAIN SUFFIX. The outlet is Heavy, not Heavy.com; Fadeaway World, not fadeawayworld.net; RealGM, not basketball.realgm.com. A reader writing about a site does not type its hostname. The one exception is NBA.com, which is what the league site is actually called.\n\nPLACE ANYONE WHO IS NOT A PLAYER, USING THE WORDS THE ITEM ITSELF GIVES THEM. A reporter, analyst, agent, coach or executive is introduced on first mention — but with the description in front of you, not one you supply. When the item says 'team insider Khobi Price', write 'Lakers insider Khobi Price'; do not promote him to 'Heavy's Khobi Price' because Heavy is the site you are reading. That is how a Lakers beat writer became a Heavy staffer, and it is false: Heavy, Fadeaway World, BBall Rumors and ClutchPoints are aggregators, so most people they name work somewhere else. NEVER attribute a person to the outlet named above as 'Outlet:' — that outlet is printed on the card already, so 'Tim MacMahon reports' is both shorter and safer than 'ESPN's Tim MacMahon reports'. If the item gives no description at all, and you cannot tell who someone is, use their job or leave them unplaced rather than inventing an employer: 'agent Mike George', 'Jazz general manager Justin Zanik'. A reader meeting 'Bobby Marks notes the swap leaves Minnesota below the apron' cannot tell whether that is a reporter, an executive or a player, and has no reason to believe him. Players need no such placing: the card lists them beneath the summary and the whole site is about them.\n\nA REPORTER'S SOURCES ARE NOT PART OF THE STORY. When a report says it learned something from agents, league sources, rival executives or people briefed on the talks, write what was learned and not who told them. 'Ben Simmons has agreed to a one-year deal, according to Shams Charania and ESPN's Marc J. Spears, who cited agents Max Wiepking, Sean Tribe and Ryan Arney' spends nineteen words on the chain of custody for a fact nobody disputes. Name an agent only when he is DOING something in the story: negotiating, representing a client in the move being described, or being quoted on it. 'Aaron Turner, agent for Jonathan Kuminga, said on FanDuel TV that Minnesota had called' earns its place; 'who cited agents' does not. The rule above places the people a story is about, not the people a reporter rang.\n\nPLACE THEM ONCE, AND ONLY WHERE IT EARNS ITS SPACE. Once in a summary is enough — after that the surname alone. And skip it entirely when the affiliation is already on the card: on an ESPN item write 'Tim MacMahon reports', not 'ESPN's Tim MacMahon reports', because the outlet is printed directly above. The possessive is for a name the reader could not otherwise place — a ClutchPoints reporter cited in a Heavy story, an ESPN analyst quoted by RealGM.\n\nWHEN THE ITEM NAMES THE REPORTER'S OWN OUTLET AND IT IS NOT THE OUTLET ABOVE, THAT AFFILIATION IS REQUIRED. Not optional, not a nicety: it is the reader's only way to weigh the claim. A Fadeaway World item saying 'The Ringer's Zach Lowe revealed' became 'Zach Lowe said' here, which drops the one fact that tells a reader whose reporting this is. Aggregators are most of where this arises — Heavy, Fadeaway World, Hoops Rumors, BBall Rumors and ClutchPoints are quoting other people's work almost every time, so a name in front of you usually belongs to someone else's masthead. The rule above forbids crediting THIS outlet for someone else's reporting; it does not license dropping an affiliation the item handed you. THIS IS RARE AND IT IS NARROW. The archive was checked: one post in 181 that named a reporter had dropped an affiliation its source supplied. Most items name a reporter with no employer attached at all, and those must stay unplaced — an affiliation the item does not give you is one you do not have, and inventing one is the worse error. Add the outlet only when the words are in front of you.\n\nA few names stand alone because the name IS the credential, and placing them reads as condescension: Marc Stein and Stephen A. Smith. Write them plainly. Everyone else gets placed, however well you think they are known.\n\nFULL NAMES ON FIRST MENTION. Every player gets a first name and a surname the first time they appear in the summary. A surname alone is ambiguous the moment two players share one, and this league is full of them: 'Williams, the 2024 lottery pick and brother of Jalen Williams' reads as if a man were his own brother, where 'Cody Williams, the 2024 lottery pick and brother of Jalen Williams' says it plainly. The same holds for Thompson, Green, Jones, Johnson, Smith and every Payton, Hardaway and Porter on the roster. After the first mention the surname alone is fine.\n\nPLAIN WORDS FOR PLAIN THINGS. A proposed trade is a trade idea, a proposal, a trade rumor or simply a deal — not a 'framework', which is front-office jargon and reads as one: 'Svyatoslav Rovenchuk at LakeShowLife, in a framework picked up by Heavy' should say 'in a trade rumor picked up by Heavy'. Same for the rest of the register: say what a thing is in the word a reader would use.\n\nPREFER THE CONCRETE. The mechanism (sign-and-trade, qualifying offer, team option, trade exception), the figures, the other teams in the running, who said it and where they said it — 'on a Bleacher Report live stream', 'on his podcast'. If the item hands you two facts, give the reader both.\n\nONE IDEA TO A SENTENCE. Most sentences run under 20 words and none runs over 30. The archive was measured on 5 Sep 2026: the mean was 22.8 words a sentence, 41% of sentences were over 25 words, 23% were over 30, and the longest was 65 - a paragraph with three commas in it, met at a 62-character measure. The fix is never to drop a fact. It is to stop chaining clauses. ', which would', ', meaning', ', given', ', though' and ', while' are almost always a full stop in disguise, and the connective tissue is the only thing that disappears when you split. 'San Antonio sits just $2.15M below the luxury tax, so adding a minimum-salary player now would push them into taxpayer status, meaning the front office might wait until November 11 or later in the season to fill that spot' is 38 words carrying three ideas. 'San Antonio sits just $2.15M below the luxury tax. Adding a minimum-salary player now would push them into taxpayer status. The front office might wait until November 11 or later to fill the spot.' is the same three facts, a word shorter, and nothing in it longer than 16 words. Carry at most one subordinate clause in a sentence, and at most two commas.\n\nDO NOT OVERDO IT. Six nine-word sentences in a row is a telegram, not a report, and this reads as a professional site or it reads as nothing. Vary the length: a 10-word sentence after a 22-word one is the rhythm, with the mean somewhere near 16. One genuinely long sentence is right when it carries a real list - the players in a package, a stat line, the teams in the running. 'The 6-foot-10 guard/forward averaged 5.0 points, 4.7 rebounds and 5.6 assists in 51 total games between the Nets and Clippers' is 21 words and reads easily, because it is one idea with items in it rather than three ideas welded together.\n\nTWO INDEPENDENT CLAUSES ARE TWO SENTENCES. This is the half that survives after the subordinate clauses are gone, and it hides behind 'and', 'but' and a trailing comma. 'Last fall he was signed and waived near the end of camp so Milwaukee could give him an Exhibit 10 bonus and send him to their G League affiliate, and the same plan likely applies again this year' is 38 words and two complete thoughts; cut it at the last 'and'. Two reporting verbs in one sentence are the same fault: 'He notes Jovic's contract makes him harder to move but says Miami wouldn't hesitate to include him' is a note and a claim, so give each a sentence. If the clause on either side of 'and' or 'but' could stand alone with a full stop in front of it, put one there.\n\nATTRIBUTION DOES NOT CARRY A SECOND FACT. Naming the reporter already costs six or eight words at the front of a sentence, so do not hang a further claim off the back of it. 'New York Post reporter Stefan Bondy corrected an earlier claim about Miles McBride's extension rules, saying the Knicks guard could sign a deal worth roughly three years and $55 million while still remaining trade-eligible this season' is 36 words doing three jobs. Give the fact its own sentence and let the attribution sit on the shorter one: 'Miles McBride can sign an extension worth roughly three years and $55 million and stay trade-eligible this season. New York Post reporter Stefan Bondy was correcting an earlier report.' A sentence that is long ONLY because it names a reporter and then lists what a package contains is fine - that is one idea with items in it, and it is the exception the rule above allows.\n\nSHORTER SENTENCES ARE NOT PERMISSION TO WRITE MORE OF THEM. Splitting a sentence in two should leave the summary the same length or shorter, never longer. The ceiling rose to six sentences so the facts an item gives you can arrive one at a time; it is not a target, and LENGTH FOLLOWS SUBSTANCE still governs. A three-fact item is three or four short sentences, not six.\n\nPARAGRAPHS. Once the summary runs to three or more sentences, separate it into paragraphs with a blank line, breaking where the subject shifts — the terms, then the context; the move, then what it means for the roster. Two sentences stay as one paragraph. The reader meets this at a 62-character measure, where five sentences unbroken is a twelve-line wall.\n\nMANY ITEMS ARE A HEADLINE AND NOTHING ELSE. When that is all you have, write the one sentence the headline supports and stop. One accurate sentence is a good summary. Do not reach for a second or third by describing what the item does not contain.",
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
            description:
              "True for the player the move is actually about.",
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
    "isRoundup",
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
export const SYSTEM = `You extract NBA transfer news for nbarumors.cc.

You are given the headline and summary of a news item from a sports feed. Your job:

1. Decide whether it is about a player transfer, trade, signing, contract, buyout, waiver, or draft move. Most items are not — game recaps, standings, awards, off-court news, and pure injury reports are all rejected.
2. If it is, extract the structured facts and write an ORIGINAL headline and 2-4 sentence summary.

Rules for the text you write:
- Write in your own words. Never reuse the source's phrasing or sentence structure. The source text is copyrighted; you are reporting the underlying facts, which are not.
- Attribute reported claims to the outlet or reporter.
- Do not overstate certainty. If a move is speculation, say so.
- No hype, no invented details. If the source does not say it, it does not go in.

VOICE — punchy and irreverent:
- Short sentences: one idea each, most under 20 words, none over 30, at most two commas and at most one subordinate clause. Split rather than chain - a comma before "which", "meaning", "given" or "while" is usually a full stop. Lead with what matters and skip the throat-clearing; no "in a move that will surely" wind-ups. Vary the length so it does not read as a telegram; a long sentence is fine when it is one idea carrying a list.
- Dry wit is welcome. Corniness, exclamation marks and puns on player names are not.
- You may close with one line of perspective, but it must ADD something, and it may only draw on facts stated in THIS item. Commentary on the shape of the deal is fine — that it is short, cheap, long, sudden. Commentary on the shape of the reporting is not: how thin the sourcing is, whether anyone is named, whether anything is agreed. That is the badge's job, and coming from us it reads as a sneer at the outlet we are citing. Do not mirror the source's own weariness back at the reader either — an item that opens "another day, another Kuminga update" is not licence to write "still no signing". Anything you happen to know from elsewhere is not: no nicknames or reputations ("the pest"), no playing-style or role assessments ("bench scoring"), no career-pattern claims ("another one-year deal"), no cap or roster consequences. If the item gives you nothing to say, end after the facts — a missing closing line is always better than an unsourced one.
- Never assert what a team, player or agent has or has not confirmed, denied or announced unless the source says so explicitly. Absence of a statement in the source is not evidence that no statement exists.
- Never invent scouting takes, salary-cap consequences, locker-room dynamics or a player's reputation as if they were reported facts.
- The skepticism, when a story is thin, belongs in plain description — "this is speculation, with no named sourcing" — not in sneering at the player.

Valid team abbreviations: ${TEAM_LIST}`;

const client = new Anthropic();

/**
 * Headlines written recently, passed in so the next one does not echo them.
 *
 * Every item is extracted on its own, which is why the wire drifts into a
 * house formula: nothing tells the model that the last four posts all began
 * "Hypothetical trade sends" or "X would land in Y". Nine headlines said
 * "would land" and fourteen said "floated" before anyone noticed, and no
 * per-item instruction can prevent that, because the problem only exists
 * between items.
 *
 * Cheap: eight headlines is around a hundred tokens, and it goes in the user
 * turn, so the cached system prompt is untouched.
 */
/**
 * The name an outlet should be called in prose.
 *
 * `feed_items.publisher` is whatever the feed announced, and for most of them
 * that is a bare hostname: heavy.com (151 items), sports.yahoo.com (75),
 * basketball.realgm.com (48), hoopsrumors.com (39), fadeawayworld.net (32).
 * The extraction prompt is handed that string as "Outlet:", so when a summary
 * reads "Heavy.com floats a trade" the model is repeating what we told it the
 * outlet was called. The fix belongs here rather than in an instruction not to
 * write what we supplied.
 *
 * `sources.name` already holds the clean version — Heavy, RealGM, Yahoo
 * Sports, CBS Sports — so a hostname-shaped publisher defers to it.
 *
 * NBA.com is deliberately not caught: it is the brand, not a hostname standing
 * in for one, and "the NBA.com transaction log" is what that thing is called.
 */
export function outletName(
  publisher: string | null | undefined,
  sourceName: string,
): string {
  if (!publisher) return sourceName;
  const name = publisher.trim();

  /*
   * Brands that happen to contain a dot. NBA.com is what the league's site is
   * called — "the NBA.com transaction log" is the thing's name, not a hostname
   * standing in for one — so it is left alone where heavy.com is not.
   */
  if (BRANDS_WITH_A_DOT.has(name.toLowerCase())) return name;

  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(name)) return name;

  /*
   * A known host resolves to its masthead regardless of how the item reached
   * us, rather than depending on the source row being well named.
   *
   * Correcting what this comment said first: it claimed gnews-woj-shams
   * carried thirty heavy.com items, which was three Google News sources added
   * together and attributed to one. That feed is a search for "NBA sources
   * tell ESPN trade OR sign" and has delivered fifteen items, every one of
   * them ESPN. The thirty heavy.com items came through gnews-trade-rumors,
   * which has been off since 26 August.
   *
   * The volume that matters is on the direct feeds, all enabled: yahoo 608,
   * heavy 212, sportando 143, fadeaway 109, realgm 106. Those already resolved
   * through `sources.name`. What the map adds is the Google News tail —
   * espn.in, bballrumors.com — and independence from source naming.
   */
  const known = HOST_NAMES[name.toLowerCase()];
  if (known) return known;

  /*
   * Google News is a redirector: its source row names the middleman, not the
   * outlet, so falling back to it would replace a real publisher with "Google
   * News". Drop the suffix instead, so no domain reaches prose either way.
   */
  if (/google\s*news/i.test(sourceName)) {
    return name.replace(/^www\./i, "").replace(/\.[a-z.]{2,6}$/i, "");
  }

  return sourceName;
}

/** Kept deliberately short; add only names a reader would write with the dot. */
const BRANDS_WITH_A_DOT = new Set(["nba.com", "basketnews.com"]);

/**
 * Hostnames to the name a reader would use, for outlets that reach us through
 * more than one door. Every entry here has actually appeared in `publisher`.
 */
const HOST_NAMES: Record<string, string> = {
  "heavy.com": "Heavy",
  "espn.com": "ESPN",
  "espn.in": "ESPN",
  "sports.yahoo.com": "Yahoo Sports",
  "basketball.realgm.com": "RealGM",
  "hoopsrumors.com": "Hoops Rumors",
  "fadeawayworld.net": "Fadeaway World",
  "cbssports.com": "CBS Sports",
  "sportando.basketball": "Sportando",
  "bballrumors.com": "BBall Rumors",
  "bolavip.com": "Bolavip",
  "olympics.com": "Olympics.com",
  "ascendants.in": "Ascendants",
};

/**
 * Whether a summary opens by naming the outlet as its subject.
 *
 * The prompt has told the model not to do this from the beginning — the card
 * prints the outlet directly above the body, as a link — and it mostly obeys:
 * 29 of 726 posts open with an outlet name. But an instruction the model
 * follows 96% of the time is not a guarantee, and "Heavy.com floats a trade
 * sending Mikal Bridges to Dallas" spends its opening words on what the reader
 * can already see.
 *
 * The possessive used to be exempt — "ESPN's Tim MacMahon reports" was read as
 * attribution rather than an outlet opener, and allowed. That exemption was
 * wrong twice over, and it produced "Heavy's Khobi Price floats a trade".
 *
 * Wrong first because this function is only ever handed the CARD'S OWN outlet
 * names, so the exemption permitted precisely the construction the prompt
 * forbids: the affiliation is already printed above the sentence, and
 * "MacMahon reports" says the same thing in fewer words.
 *
 * Wrong second, and worse, because it is frequently false. Heavy, Fadeaway
 * World and BBall Rumors are aggregators — nearly everyone they name is
 * somebody else's reporter. Heavy called Khobi Price a "team insider" and
 * never claimed him; we made him theirs. He covers the Lakers.
 */
export function opensWithOutlet(body: string, names: (string | null)[]): boolean {
  const head = body.trimStart();
  for (const name of names) {
    if (!name) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`^${esc}\\b`, "i").test(head)) return true;
  }
  return false;
}

/**
 * Sites that are quoting somebody else's reporting nearly every time.
 *
 * These are the outlets where naming ourselves is a real fault rather than a
 * style preference. An aggregator with a reporter to credit names the
 * reporter; an aggregator with nobody to credit reaches for its own masthead
 * as the attribution of last resort, and that is the whole failure. Measured
 * over 600 posts on 5 Sep 2026: Heavy named itself in 24% of the posts where
 * no reporter was credited against 9% where one was, Fadeaway World 22%
 * against 8%, Hoops Rumors 20% against 7%. RealGM and Sportando never did it.
 *
 * DELIBERATELY NOT EVERY OUTLET. ESPN names itself at a far higher rate, but
 * as "his agency Equity Sports told ESPN" - somebody spoke TO them, which is
 * ordinary reporting and not ours to rewrite. Basketball-Reference carries
 * "per Basketball-Reference" on transaction records, where it is naming a
 * database rather than claiming a report. Both would be damaged by this
 * check, so both sit outside it.
 *
 * HoopsHype is left out for the same reason: Michael Scotto is their own
 * reporter, so "told Michael Scotto of HoopsHype" is a first-party byline.
 */
export const AGGREGATORS = new Set([
  "heavy",
  "fadeaway world",
  "hoops rumors",
  "bball rumors",
  "clutchpoints",
]);

/**
 * Does an aggregator's summary cite the aggregator?
 *
 * Separate from opensWithOutlet, which anchors at the start of the body and
 * therefore only ever caught the masthead-as-first-word case. The two live
 * patterns both sat elsewhere in the sentence - "A hypothetical framework
 * floated by Heavy would send..." and "...four draft picks, according to
 * Heavy." - and passed the opening check untouched.
 *
 * Capitalisation is required rather than folded, which is not fussiness: a
 * case-insensitive match fired on "a heavy haul of first-round picks" and
 * would have spent a retry repairing a correct sentence.
 */
export function namesOwnOutlet(body: string, names: (string | null)[]): boolean {
  for (const raw of names) {
    if (!raw) continue;
    const name = raw.trim();
    if (!AGGREGATORS.has(name.toLowerCase())) continue;
    for (let i = body.indexOf(name); i >= 0; i = body.indexOf(name, i + 1)) {
      const before = i === 0 ? " " : body[i - 1];
      const after = body[i + name.length] ?? " ";
      if (/[A-Za-z]/.test(before) || /[A-Za-z]/.test(after)) continue;
      return true;
    }
  }
  return false;
}

/**
 * Verbs the model reaches for too readily in headlines.
 *
 * "eye" is the first. It is not wrong — "Cavs eye Diop" is honest about
 * interest that has not become a deal — but it became the default: four live
 * headlines used it inside 24 hours on 29 and 30 Aug 2026, and 14 posts carry
 * it in total. Read down the Latest feed and it stops sounding like reporting
 * and starts sounding like a house tic.
 *
 * DEPRIORITISED, NOT BANNED, which is the whole design of this check. A flat
 * ban would be the wrong instrument: the word is fine occasionally, and
 * forbidding it outright pushes the model to a single replacement that becomes
 * the next tic. So the test fires only when a RECENT headline already used the
 * verb — the same eight headlines `recentHeadlines` shows the model. Used once
 * in a quiet week it passes untouched; used twice in an evening it retries.
 *
 * This deserves a deterministic check where general repetition does not. A
 * shared word between two headlines is usually legitimate — "Rockets sign
 * Tate" and "Rockets sign Crawford" are two real signings in the only sensible
 * words — so a regex on shared words would fire mostly on correct headlines.
 * One named verb is an exact match with no judgement in it.
 */
const TIRED_VERBS = [/\beye(s|d|ing)?\b/i];

export function repeatsTiredVerb(headline: string, recent: string[]): boolean {
  return TIRED_VERBS.some((re) => re.test(headline) && recent.some((h) => re.test(h)));
}

/**
 * What one call cost, in tokens, split by how each part was billed.
 *
 * Reported so a broken cache cannot hide. Prompt caching fails silently by
 * design — the requests still succeed and only the bill moves — and the
 * cached prefix here is 8,000 tokens, most of it the schema. Every edit to
 * the system prompt or the schema rewrites that prefix, and this file is
 * edited often: three times on 30 Aug 2026 alone. Without the usage numbers
 * a change that stopped caching entirely would look exactly like one that
 * did not.
 *
 * `cacheRead` is the number to watch. If it goes to zero across a run while
 * `cacheWrite` stays high, the prefix is being invalidated somewhere.
 */
export type CallUsage = {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
};

export async function extractRumor(item: {
  title: string;
  rawSummary: string | null;
  publisher: string | null;
  sourceName: string;
  recentHeadlines?: string[];
}, opts: { retry?: "outlet" | "verb"; onUsage?: (u: CallUsage) => void } = {}): Promise<Extraction> {
  const { retry, onUsage } = opts;
  const response = await client.messages.create({
    model: modelFor(),
    max_tokens: 2000,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: SCHEMA },
    },
    /*
     * A one-hour cache, not the five-minute default.
     *
     * The system prompt and the schema are ~6,400 tokens and cache together,
     * but the extract cron fires every 30 minutes and a default entry has
     * expired long before the next run reaches it, so every run started cold.
     * Measured over three days, 311 of 901 calls paid the cache WRITE rate of
     * 1.25x rather than the read rate of 0.1x, and that was most of the bill.
     * An hour outlives the gap between runs, so a run inherits the entry the
     * last one wrote. A 1h write costs 2x rather than 1.25x; at one write an
     * hour against roughly a hundred, that trade is heavily one-sided.
     *
     * enrich.ts now takes the same hour, and for the same reason. This comment
     * used to say the opposite — that both merge-path callers ran far less
     * often than hourly — and the measurement on 30 Aug 2026 contradicted it:
     * 998 source attachments in seven days, about 5.9 an hour.
     *
     * same-story.ts has no marker at all. Its prompt is 284 tokens and Sonnet
     * will not cache a prefix under 1,024, so the one it used to carry was
     * silently inert rather than merely suboptimal.
     */
    system: [
      {
        type: "text",
        text: SYSTEM,
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          `Outlet: ${outletName(item.publisher, item.sourceName)}`,
          `Headline: ${item.title}`,
          `Summary: ${item.rawSummary ?? "(none provided)"}`,
          ...(item.recentHeadlines?.length
            ? [
                ``,
                `Headlines we published most recently. Do not echo their construction — the reader sees these on the same page as yours, and four in a row built the same way reads as a template rather than a wire:`,
                ...item.recentHeadlines.slice(0, 8).map((h) => `  ${h}`),
              ]
            : []),
          /*
           * Said again, and specifically, only on the retry. Repeating the
           * whole instruction every time would cost tokens on the 99% that
           * already comply and would weaken by repetition.
           */
          ...(retry === "outlet"
            ? [
                ``,
                `Your previous attempt named the outlet printed on the card, either as the opening subject or later in the summary. Do not name it anywhere: not \"floated by\", not \"according to\", not \"per\". The card prints it directly above as a link, so the words tell the reader nothing they cannot already see. If the item credits a reporter or a different outlet, name THAT one instead. If it credits nobody, carry it in the verb and stop: \"A trade idea would send...\" needs no source at all. Open with the substance: the player, the teams, the terms or the named reporter. "${outletName(item.publisher, item.sourceName)} floats a trade sending..." is wrong; "A trade idea would send..." or "Tim MacMahon reports..." is right.`,
              ]
            : []),
          ...(retry === "verb"
            ? [
                ``,
                `Your previous headline used "eye" or "eyes", and one of the headlines listed above already uses it. Write the headline again with a different verb. Say what the interest actually amounts to: considers, targets, weighs, pursues, turns to, is in the market for, is linked to, leads the options for. Better still, replace the verb with the specific fact — "Diop is the frontrunner for Cleveland's last roster spot" beats "Cavs eye Diop".`,
              ]
            : []),
        ].join("\n"),
      },
    ],
  });

  /* Before any early return, so a refusal still reports what it cost. */
  onUsage?.({
    input: response.usage.input_tokens,
    cacheRead: response.usage.cache_read_input_tokens ?? 0,
    cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    output: response.usage.output_tokens,
  });

  // Safety classifiers can decline; check before reading content.
  if (response.stop_reason === "refusal") {
    throw new Error("model declined to process this item");
  }

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error(`no text block in response (stop: ${response.stop_reason})`);
  }
  const parsed = JSON.parse(text.text) as Extraction;

  /*
   * One retry when the summary opens by naming the outlet, and only then.
   *
   * Repaired rather than rejected: enrichment can return null and lose
   * nothing, because the post already exists. Here a rejection loses the post,
   * and a clumsy opening sentence is a far smaller problem than a story the
   * site never carries. So the second attempt is the last — if it opens the
   * same way again, the body stands.
   *
   * Costs one extra call on roughly 1% of items, since this fires only on the
   * bare-masthead case that survived the instruction.
   */
  if (
    !retry &&
    parsed.isRumor &&
    parsed.body &&
    (opensWithOutlet(parsed.body, [outletName(item.publisher, item.sourceName), item.publisher, item.sourceName]) ||
      namesOwnOutlet(parsed.body, [outletName(item.publisher, item.sourceName), item.publisher, item.sourceName]))
  ) {
    return extractRumor(item, { retry: "outlet", onUsage });
  }

  /*
   * The same one-shot repair for a headline verb the recent feed already used.
   *
   * Ordered after the outlet check because a summary that opens with a
   * masthead is the worse fault, and only one retry is spent per item. Like
   * that one it repairs rather than rejects: if the second attempt reaches for
   * "eye" again, the headline stands. A tired verb is a smaller problem than a
   * story the site never carries.
   */
  if (
    !retry &&
    parsed.isRumor &&
    parsed.headline &&
    repeatsTiredVerb(parsed.headline, item.recentHeadlines ?? [])
  ) {
    return extractRumor(item, { retry: "verb", onUsage });
  }

  /*
   * Every field a person's name can reach, not only the two a reader sees.
   * A mangled body is a typo; a mangled name becomes a slug, and that is a
   * duplicate player and a dead URL that outlive the post.
   */
  return {
    ...parsed,
    headline: decodeStrayEscapes(parsed.headline),
    body: decodeStrayEscapes(parsed.body),
    reportedBy: parsed.reportedBy && decodeStrayEscapes(parsed.reportedBy),
    players: parsed.players?.map((p) => ({
      ...p,
      name: decodeStrayEscapes(p.name),
    })),
  };
}


