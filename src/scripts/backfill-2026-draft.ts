import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Backfill wire posts for the 2026 NBA draft.
 *
 * The draft ran on 23-24 June 2026 and the site covered none of it: June holds
 * 21 published posts and not one is typed `draft`, because ingestion was barely
 * running that month. There is nothing in `feed_items` to re-extract, so the
 * gap cannot be closed by replaying the pipeline — the articles have to be
 * brought in from outside.
 *
 * Written by hand rather than extracted, deliberately:
 *
 *   - It costs nothing. Twelve items through the normal path would be twelve
 *     Anthropic calls; these are supplied directly.
 *   - It is a backfill of settled history, not a rule change. Nothing here
 *     should influence how future items are read.
 *
 * Every post carries a real article at a real outlet, and both outlets are
 * already in `sources` — ESPN is id 1 and RealGM id 2 — so attribution works
 * exactly as it does for anything else on the wire. Facts and quotes come from
 * those articles; nothing is invented.
 *
 * Runs through `publishExtraction` rather than inserting rows, so player
 * creation, team tagging, slugs, holds and same-event merging all behave the
 * way they do for live items.
 *
 *   npx tsx src/scripts/backfill-2026-draft.ts --dry
 *   npx tsx src/scripts/backfill-2026-draft.ts --apply
 */

import type { Extraction } from "@/lib/extract";

type Post = {
  sourceId: number;
  sourceSlug: string;
  publisher: string;
  url: string;
  /** The article's own headline, kept as the feed item's title. */
  title: string;
  publishedAt: string;
  extraction: Extraction;
};

const base = {
  isRumor: true as const,
  rejectedReason: null,
  contractValue: null,
  contractYears: null,
};

const POSTS: Post[] = [
  /* ---------------------------------------------------------------- lottery */
  {
    sourceId: 1,
    sourceSlug: "espn-nba",
    publisher: "ESPN",
    url: "https://www.espn.com/nba/story/_/id/48742366/washington-wizards-nba-lottery-draft-2026-first-overall-pick-aj-dybantsa",
    title:
      "Inside an 'incredible day of luck': How Wizards won the NBA draft lottery",
    publishedAt: "2026-05-12T22:30:00Z",
    extraction: {
      ...base,
      type: "draft",
      isRoundup: false,
      status: "confirmed",
      confidence: 0.95,
      eventKey: "wizards-lottery-win-first-pick",
      headline: "Wizards win the lottery and the right to pick first in 2026",
      body: "ESPN's Ohm Youngmisuk reports Washington won the May 12 lottery after finishing 17-65, the first team to convert the league's worst record into the top pick since the 2019 format change. It is the franchise's first lottery win since taking John Wall in 2010, and ESPN projects BYU forward AJ Dybantsa as the selection.",
      reportedBy: "Ohm Youngmisuk",
      players: [
        { name: "AJ Dybantsa", isPrimary: true, fromTeam: null, toTeam: "WAS" },
      ],
      teams: [{ abbreviation: "WAS", role: "to" }],
    },
  },

  /* ------------------------------------------------------------- pre-draft */
  {
    sourceId: 2,
    sourceSlug: "realgm-wiretap",
    publisher: "RealGM",
    url: "https://basketball.realgm.com/wiretap/285344/AJ-Dybantsa-Considered-Most-Probable-No-1-Pick-Ahead-Of-2026-NBA-Draft-Lottery",
    title:
      "AJ Dybantsa Considered Most Probable No. 1 Pick Ahead Of 2026 NBA Draft Lottery",
    publishedAt: "2026-05-08T14:00:00Z",
    extraction: {
      ...base,
      type: "draft",
      isRoundup: false,
      status: "rumor",
      confidence: 0.7,
      eventKey: "dybantsa-projected-top-selection-preseason",
      headline: "Dybantsa seen as the most likely first pick before the lottery",
      body: "RealGM reports that AJ Dybantsa was regarded around the league as the most probable No. 1 selection in the 2026 draft, with the order still to be settled by the lottery.",
      reportedBy: null,
      players: [
        { name: "AJ Dybantsa", isPrimary: true, fromTeam: null, toTeam: null },
      ],
      teams: [],
    },
  },
  {
    sourceId: 2,
    sourceSlug: "realgm-wiretap",
    publisher: "RealGM",
    url: "https://basketball.realgm.com/wiretap/286085/AJ-Dybantsa-Has-Met-With-Wizards-Jazz",
    title:
      "AJ Dybantsa Has Met With Wizards, Jazz; Darryn Peterson Meeting Only With Wizards",
    publishedAt: "2026-06-17T15:20:00Z",
    extraction: {
      ...base,
      type: "draft",
      isRoundup: false,
      status: "reported",
      confidence: 0.78,
      eventKey: "dybantsa-peterson-team-visits",
      headline: "Dybantsa meets both teams at the top, Peterson only Washington",
      body: "RealGM reports AJ Dybantsa met with Washington and Utah before the draft while Darryn Peterson met only with the Wizards, the two prospects the top of the board had narrowed to.",
      reportedBy: null,
      players: [
        { name: "AJ Dybantsa", isPrimary: true, fromTeam: null, toTeam: null },
        { name: "Darryn Peterson", isPrimary: true, fromTeam: null, toTeam: null },
      ],
      teams: [
        { abbreviation: "WAS", role: "mentioned" },
        { abbreviation: "UTA", role: "mentioned" },
      ],
    },
  },
  {
    sourceId: 2,
    sourceSlug: "realgm-wiretap",
    publisher: "RealGM",
    url: "https://basketball.realgm.com/wiretap/286143/Wizards-Jazz-Remain-Undecided-Between-Darryn-Peterson-AJ-Dybantsa-At-Top-Of-2026-NBA-Draft",
    title:
      "Wizards, Jazz Remain Undecided Between Darryn Peterson, AJ Dybantsa At Top Of 2026 NBA Draft",
    publishedAt: "2026-06-20T13:00:00Z",
    extraction: {
      ...base,
      type: "draft",
      isRoundup: false,
      status: "rumor",
      confidence: 0.68,
      eventKey: "wizards-jazz-split-on-top-two",
      headline: "Washington and Utah still split on Peterson or Dybantsa",
      body: "RealGM reports both the Wizards and the Jazz remained undecided between Darryn Peterson and AJ Dybantsa days out from the 2026 draft, leaving the order of the first two picks open.",
      reportedBy: null,
      players: [
        { name: "AJ Dybantsa", isPrimary: true, fromTeam: null, toTeam: null },
        { name: "Darryn Peterson", isPrimary: true, fromTeam: null, toTeam: null },
      ],
      teams: [
        { abbreviation: "WAS", role: "mentioned" },
        { abbreviation: "UTA", role: "mentioned" },
      ],
    },
  },
  {
    sourceId: 2,
    sourceSlug: "realgm-wiretap",
    publisher: "RealGM",
    url: "https://basketball.realgm.com/wiretap/286208/AJ-Dybantsa-Darryn-Peterson-Wont-Know-No-1-Pick-Until-It-Is-Announced",
    title:
      "AJ Dybantsa, Darryn Peterson Won't Know No. 1 Pick Until It Is Announced",
    publishedAt: "2026-06-23T18:00:00Z",
    extraction: {
      ...base,
      type: "draft",
      isRoundup: false,
      status: "reported",
      confidence: 0.75,
      eventKey: "dybantsa-peterson-announcement-secrecy",
      headline: "Neither top prospect will learn the first pick before Silver says it",
      body: "RealGM reports that neither AJ Dybantsa nor Darryn Peterson would be told which of them Washington had chosen until Adam Silver announced the pick on the night.",
      reportedBy: null,
      players: [
        { name: "AJ Dybantsa", isPrimary: true, fromTeam: null, toTeam: null },
        { name: "Darryn Peterson", isPrimary: true, fromTeam: null, toTeam: null },
      ],
      teams: [{ abbreviation: "WAS", role: "mentioned" }],
    },
  },

  /* ----------------------------------------------------------- draft night */
  {
    sourceId: 2,
    sourceSlug: "realgm-wiretap",
    publisher: "RealGM",
    url: "https://basketball.realgm.com/wiretap/286237/Wizards-Select-AJ-Dybantsa-Over-Darryn-Peterson-With-First-Overall-Pick-In-2026-NBA-Draft",
    title:
      "Wizards Select AJ Dybantsa Over Darryn Peterson With First Overall Pick In 2026 NBA Draft",
    publishedAt: "2026-06-24T00:15:00Z",
    extraction: {
      ...base,
      type: "draft",
      isRoundup: false,
      status: "completed",
      confidence: 0.99,
      eventKey: "dybantsa-selected-washington-first-overall",
      headline: "Wizards take Dybantsa first overall ahead of Peterson",
      body: "Washington selected BYU forward AJ Dybantsa with the first pick of the 2026 draft, per RealGM, choosing him over Darryn Peterson. Dybantsa averaged 25.5 points, 6.8 rebounds and 3.7 assists on 51 percent shooting in his one college season.",
      reportedBy: null,
      players: [
        { name: "AJ Dybantsa", isPrimary: true, fromTeam: null, toTeam: "WAS" },
        { name: "Darryn Peterson", isPrimary: false, fromTeam: null, toTeam: null },
      ],
      teams: [{ abbreviation: "WAS", role: "to" }],
    },
  },
  {
    sourceId: 2,
    sourceSlug: "realgm-wiretap",
    publisher: "RealGM",
    url: "https://basketball.realgm.com/wiretap/286234/2026-NBA-Draft-First-Round-Results-AJ-Dybantsa-Darryn-Peterson-Cameron-Boozer-Picked-Top-3",
    title:
      "2026 NBA Draft First Round Results: AJ Dybantsa, Darryn Peterson, Cameron Boozer Picked Top-3",
    publishedAt: "2026-06-24T03:00:00Z",
    extraction: {
      ...base,
      type: "draft",
      isRoundup: false,
      status: "completed",
      confidence: 0.99,
      eventKey: "opening-four-selections-recap",
      headline: "Dybantsa, Peterson and Boozer go one, two, three",
      body: "The 2026 first round opened with AJ Dybantsa to Washington, Darryn Peterson to Utah and Cameron Boozer to Memphis, per RealGM, with Caleb Wilson following at No. 4 to Chicago.",
      reportedBy: null,
      players: [
        { name: "AJ Dybantsa", isPrimary: true, fromTeam: null, toTeam: "WAS" },
        { name: "Darryn Peterson", isPrimary: true, fromTeam: null, toTeam: "UTA" },
        { name: "Cameron Boozer", isPrimary: true, fromTeam: null, toTeam: "MEM" },
        { name: "Caleb Wilson", isPrimary: true, fromTeam: null, toTeam: "CHI" },
      ],
      teams: [
        { abbreviation: "WAS", role: "to" },
        { abbreviation: "UTA", role: "to" },
        { abbreviation: "MEM", role: "to" },
        { abbreviation: "CHI", role: "to" },
      ],
    },
  },
  {
    sourceId: 1,
    sourceSlug: "espn-nba",
    publisher: "ESPN",
    url: "https://www.espn.com/nba/story/_/id/49085674/2026-nba-draft-round-1-winners-surprises-teams-picks-questions-washington-jazz-memphis",
    title: "2026 NBA draft: Round 1 winners, surprise picks, questions",
    publishedAt: "2026-06-24T06:00:00Z",
    extraction: {
      ...base,
      type: "draft",
      isRoundup: false,
      status: "completed",
      confidence: 0.95,
      eventKey: "peterson-selected-utah-pick-two",
      headline: "Jazz land Peterson at two, the board's top prospect for ESPN",
      body: "ESPN's Jeremy Woo made Utah a winner of the first round for taking Darryn Peterson at No. 2, calling him his top prospect overall and a fit for a backcourt that needed shooting and size.",
      reportedBy: "Jeremy Woo",
      players: [
        { name: "Darryn Peterson", isPrimary: true, fromTeam: null, toTeam: "UTA" },
      ],
      teams: [{ abbreviation: "UTA", role: "to" }],
    },
  },
  {
    sourceId: 1,
    sourceSlug: "espn-nba",
    publisher: "ESPN",
    url: "https://www.espn.com/nba/story/_/id/49085674/2026-nba-draft-round-1-winners-surprises-teams-picks-questions-washington-jazz-memphis",
    title: "2026 NBA draft: Round 1 winners, surprise picks, questions",
    publishedAt: "2026-06-24T06:05:00Z",
    extraction: {
      ...base,
      type: "draft",
      isRoundup: false,
      status: "completed",
      confidence: 0.93,
      eventKey: "grizzlies-boozer-lopez-pick-haul",
      headline: "Grizzlies get Boozer and five second-rounders out of the night",
      body: "ESPN's Jeremy Woo counted Memphis among the first round's winners for taking Cameron Boozer at No. 3 and then trading down and around the board, collecting five future second-round picks and landing Karim Lopez at No. 21.",
      reportedBy: "Jeremy Woo",
      players: [
        { name: "Cameron Boozer", isPrimary: true, fromTeam: null, toTeam: "MEM" },
        { name: "Karim Lopez", isPrimary: true, fromTeam: null, toTeam: "MEM" },
      ],
      teams: [{ abbreviation: "MEM", role: "to" }],
    },
  },
  {
    sourceId: 1,
    sourceSlug: "espn-nba",
    publisher: "ESPN",
    url: "https://www.espn.com/nba/story/_/id/49085674/2026-nba-draft-round-1-winners-surprises-teams-picks-questions-washington-jazz-memphis",
    title: "2026 NBA draft: Round 1 winners, surprise picks, questions",
    publishedAt: "2026-06-24T06:10:00Z",
    extraction: {
      ...base,
      type: "draft",
      isRoundup: false,
      status: "completed",
      confidence: 0.9,
      eventKey: "mavericks-morez-johnson-ninth-surprise",
      headline: "Mavericks surprise at nine with Morez Johnson Jr.",
      body: "ESPN's Jeremy Woo called Dallas taking Morez Johnson Jr. at No. 9 one of the round's surprises, noting Dusty May had three Michigan players to choose from and that the pick says what the Mavericks value.",
      reportedBy: "Jeremy Woo",
      players: [
        { name: "Morez Johnson Jr.", isPrimary: true, fromTeam: null, toTeam: "DAL" },
      ],
      teams: [{ abbreviation: "DAL", role: "to" }],
    },
  },

  /* -------------------------------------------------------------- analysis */
  {
    sourceId: 1,
    sourceSlug: "espn-nba",
    publisher: "ESPN",
    url: "https://www.espn.com/nba/story/_/id/49102074/2026-nba-draft-recap-best-value-picks-moves-rookie-year-predictions-trades",
    title: "2026 NBA draft recap: Best picks, execs buzz, ROY prediction",
    publishedAt: "2026-06-25T13:00:00Z",
    extraction: {
      ...base,
      type: "draft",
      isRoundup: false,
      status: "completed",
      confidence: 0.9,
      eventKey: "spurs-quaintance-knee-gamble",
      headline: "Spurs' gamble on Quaintance is ESPN's favorite value pick",
      body: "ESPN's Jeremy Woo named San Antonio taking Jayden Quaintance at No. 20 his favorite value of the draft. Quaintance needs knee surgery and may miss all of next season, which Woo called the correct gamble for a team that can carry the risk.",
      reportedBy: "Jeremy Woo",
      players: [
        { name: "Jayden Quaintance", isPrimary: true, fromTeam: null, toTeam: "SAS" },
      ],
      teams: [{ abbreviation: "SAS", role: "to" }],
    },
  },
  {
    sourceId: 1,
    sourceSlug: "espn-nba",
    publisher: "ESPN",
    url: "https://www.espn.com/nba/story/_/id/49102074/2026-nba-draft-recap-best-value-picks-moves-rookie-year-predictions-trades",
    title: "2026 NBA draft recap: Best picks, execs buzz, ROY prediction",
    publishedAt: "2026-06-25T13:05:00Z",
    extraction: {
      ...base,
      type: "draft",
      isRoundup: false,
      status: "reported",
      confidence: 0.8,
      eventKey: "boozer-rookie-of-year-projection",
      headline: "Boozer is ESPN's pick for Rookie of the Year",
      body: "ESPN's Jeremy Woo made Cameron Boozer his Rookie of the Year favorite, citing the clearest path to minutes and a featured role in Memphis. Woo's All-Rookie first team also had Dybantsa, Caleb Wilson, Peterson and Darius Acuff Jr.",
      reportedBy: "Jeremy Woo",
      players: [
        { name: "Cameron Boozer", isPrimary: true, fromTeam: null, toTeam: "MEM" },
      ],
      teams: [{ abbreviation: "MEM", role: "mentioned" }],
    },
  },
  {
    sourceId: 1,
    sourceSlug: "espn-nba",
    publisher: "ESPN",
    url: "https://www.espn.com/nba/story/_/id/49102074/2026-nba-draft-recap-best-value-picks-moves-rookie-year-predictions-trades",
    title: "2026 NBA draft recap: Best picks, execs buzz, ROY prediction",
    publishedAt: "2026-06-25T13:10:00Z",
    extraction: {
      ...base,
      type: "draft",
      isRoundup: false,
      status: "completed",
      confidence: 0.88,
      eventKey: "clippers-wagler-fifth-held-firm",
      headline: "Not one lottery pick was traded, and the Clippers held at five",
      body: "ESPN's Jeremy Woo reported no lottery selections changed hands in 2026, with movement starting only after No. 15. The Hawks and Grizzlies called the Clippers about No. 5, where Keaton Wagler went, but Woo said LA's asking price was justifiably high.",
      reportedBy: "Jeremy Woo",
      players: [
        { name: "Keaton Wagler", isPrimary: true, fromTeam: null, toTeam: "LAC" },
      ],
      teams: [
        { abbreviation: "LAC", role: "to" },
        { abbreviation: "ATL", role: "mentioned" },
        { abbreviation: "MEM", role: "mentioned" },
      ],
    },
  },
  {
    sourceId: 1,
    sourceSlug: "espn-nba",
    publisher: "ESPN",
    url: "https://www.espn.com/nba/story/_/id/49102074/2026-nba-draft-recap-best-value-picks-moves-rookie-year-predictions-trades",
    title: "2026 NBA draft recap: Best picks, execs buzz, ROY prediction",
    publishedAt: "2026-06-25T13:15:00Z",
    extraction: {
      ...base,
      type: "draft",
      isRoundup: false,
      status: "completed",
      confidence: 0.85,
      eventKey: "celtics-cenac-late-first-slide",
      headline: "Cenac slid to Boston at 27 and ESPN could not say why",
      body: "ESPN's Jeremy Woo questioned why Chris Cenac Jr. fell to No. 27, where Boston took him, suggesting playoff teams undervalued him while chasing veteran centers instead.",
      reportedBy: "Jeremy Woo",
      players: [
        { name: "Chris Cenac Jr.", isPrimary: true, fromTeam: null, toTeam: "BOS" },
      ],
      teams: [{ abbreviation: "BOS", role: "to" }],
    },
  },
];

/**
 * Undo a previous run, so a mistake in the data is re-runnable rather than
 * something to unpick by hand.
 *
 * The first attempt gave two posts event keys that collided with a third —
 * "was-2026-draft-lottery-no-1-pick" and "aj-dybantsa-was-2026-draft-pick-1"
 * share four of eight tokens, which is exactly the 0.50 similarity that counts
 * as one event — so the pick itself was absorbed into the lottery story. The
 * merge logic was right and the keys were wrong.
 *
 * Only rows this script created are touched: feed items carrying one of our
 * URLs, fetched today. rumor_sources, rumor_players and rumor_teams all cascade
 * from the rumor, so deleting the posts clears the tags with them.
 */
async function revert() {
  const { db } = await import("@/db");
  const { feedItems, rumors, rumorSources } = await import("@/db/schema");
  const { and, gte, inArray, or, sql } = await import("drizzle-orm");

  const urls = [...new Set(POSTS.map((p) => p.url))];

  /*
   * `inArray` rather than a raw `= any(...)`: an array bound into a plain sql
   * template arrives untyped and Postgres cannot pick an operator for it.
   */
  const items = await db
    .select({ id: feedItems.id })
    .from(feedItems)
    .where(
      and(
        inArray(feedItems.url, urls),
        gte(feedItems.fetchedAt, new Date(new Date().toDateString())),
      ),
    );
  const ids = items.map((r) => r.id);

  if (!ids.length) {
    console.log("nothing to revert");
    return;
  }

  /*
   * Posts reached two ways: the item that created them, and — for the ones
   * that merged — the item that attached to someone else's post.
   */
  const byItem = await db
    .select({ id: rumors.id })
    .from(rumors)
    .where(inArray(rumors.feedItemId, ids));
  const byAttachment = await db
    .select({ id: rumorSources.rumorId })
    .from(rumorSources)
    .where(inArray(rumorSources.feedItemId, ids));
  const rumorIds = [...new Set([...byItem, ...byAttachment].map((r) => r.id))];

  console.log(`reverting ${rumorIds.length} posts and ${ids.length} feed items`);
  if (rumorIds.length) {
    await db.delete(rumors).where(inArray(rumors.id, rumorIds));
  }
  // Any stragglers attached to posts we are not deleting.
  await db.delete(rumorSources).where(inArray(rumorSources.feedItemId, ids));
  await db.delete(feedItems).where(inArray(feedItems.id, ids));
  void or;
  void sql;
  console.log("reverted");
}

async function main() {
  const apply = process.argv.includes("--apply");

  if (process.argv.includes("--revert")) {
    await revert();
    return;
  }

  const { db } = await import("@/db");
  const { feedItems } = await import("@/db/schema");
  const { canonicalizeUrl, urlHash } = await import("@/lib/urls");
  const { publishExtraction } = await import("@/lib/publish");
  const { eq } = await import("drizzle-orm");

  console.log(`${POSTS.length} posts, ${apply ? "APPLYING" : "dry run"}\n`);

  const counts: Record<string, number> = {};
  for (const post of POSTS) {
    const canonical = canonicalizeUrl(post.url);

    if (!apply) {
      console.log(
        `  [${post.publisher}] ${post.extraction.headline}\n` +
          `      ${post.publishedAt.slice(0, 10)} · ${post.extraction.status} · key ${post.extraction.eventKey}`,
      );
      counts.dry = (counts.dry ?? 0) + 1;
      continue;
    }

    /*
     * One feed item per POST, not per URL. Three of these share an ESPN
     * article — a winners-and-surprises piece carries several separate stories
     * — and the url_hash is unique, so the shared ones are suffixed to keep
     * their own row. The rumor still links to the real article.
     */
    const suffix = `#${post.extraction.eventKey}`;
    const itemUrlHash = urlHash(canonical + suffix);

    const [item] = await db
      .insert(feedItems)
      .values({
        sourceId: post.sourceId,
        urlHash: itemUrlHash,
        url: post.url,
        title: post.title,
        rawSummary: post.extraction.body.slice(0, 300),
        publisher: post.publisher,
        publishedAt: new Date(post.publishedAt),
      })
      .onConflictDoNothing({ target: feedItems.urlHash })
      .returning({ id: feedItems.id });

    let itemId = item?.id;
    if (!itemId) {
      const [existing] = await db
        .select({ id: feedItems.id })
        .from(feedItems)
        .where(eq(feedItems.urlHash, itemUrlHash));
      itemId = existing?.id;
    }
    if (!itemId) {
      console.log(`  ! could not create feed item for ${post.extraction.headline}`);
      continue;
    }

    const result = await publishExtraction(
      {
        id: itemId,
        sourceId: post.sourceId,
        url: post.url,
        title: post.title,
        publisher: post.publisher,
        publishedAt: new Date(post.publishedAt),
        sourceSlug: post.sourceSlug,
      },
      post.extraction,
    );

    counts[result.status] = (counts[result.status] ?? 0) + 1;
    const detail = result.status === "rejected" ? result.reason : `#${result.rumorId}`;
    console.log(`  ${result.status.padEnd(9)} ${detail.padEnd(8)} ${post.extraction.headline}`);
  }

  console.log("\n" + JSON.stringify(counts));
  if (!apply) console.log("dry run — pass --apply to write");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
