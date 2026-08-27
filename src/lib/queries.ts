import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { headshotFor, logoFor } from "@/lib/images";
import { db } from "@/db";
import { isSameEvent } from "@/lib/event-key";
import {
  feedItems,
  playerSlugRedirects,
  playerImages,
  players,
  rumorPlayers,
  rumorTeams,
  rumors,
  sources,
  teams,
} from "@/db/schema";

export type FeedRumor = {
  id: number;
  slug: string;
  headline: string;
  body: string;
  type: string;
  status: string;
  reportedBy: string | null;
  sourceName: string;
  sourceUrl: string;
  publishedAt: Date;
  /** Set when a later report grew the summary; null on an untouched post. */
  bodyUpdatedAt: Date | null;
  imageUrl: string | null;
  imageAttribution: string | null;
  sourceCount: number;
  alsoReportedBy: string | null;
  chain: { outlet: string; headline: string; url: string; at: string }[];
  sourceSlug: string;
  contractValue: string | null;
  contractYears: number | null;
  outcome: string | null;
  outcomeAt: Date | null;
  hotMentions: number;
  confidence: number;
  teams: {
    slug: string;
    abbreviation: string;
    city: string;
    name: string;
    logoUrl: string | null;
    primaryColor: string;
    role: string;
  }[];
  players: {
    slug: string;
    fullName: string;
    isPrimary: boolean;
    headshotUrl: string | null;
    prominence: number;
    /** Where this player goes, on a post that moves more than one. */
    fromAbbrev: string | null;
    toAbbrev: string | null;
  }[];
};

/**
 * One query for the cards plus two for the tags, then stitched in memory —
 * cheaper than a triple join that fans out rows per tag.
 */
/**
 * The teams a move actually involves come before the ones a report merely
 * name-checks, and "from" leads "to" so a trade reads in its own direction.
 *
 * Only "from" used to be ranked, which left "to" and "mentioned" tied and let
 * the row order out of Postgres decide. A Josh Hart extension therefore read
 * "BOS / NYK / PHX": Boston and Phoenix appeared because the report cites
 * Derrick White and Dillon Brooks as salary comparables, and Boston happens to
 * be team 1 in the table. Hart's actual team came second, in a post about him.
 */
const TEAM_ROLE_ORDER: Record<string, number> = { from: 0, to: 1, mentioned: 2 };

async function hydrate(rows: Awaited<ReturnType<typeof baseSelect>>): Promise<FeedRumor[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const teamRows = await db
    .select({
      rumorId: rumorTeams.rumorId,
      role: rumorTeams.role,
      slug: teams.slug,
      abbreviation: teams.abbreviation,
      city: teams.city,
      name: teams.name,
      nbaTeamId: teams.nbaTeamId,
      primaryColor: teams.primaryColor,
    })
    .from(rumorTeams)
    .innerJoin(teams, eq(teams.id, rumorTeams.teamId))
    .where(sql`${rumorTeams.rumorId} in ${ids}`);

  const playerRows = await db
    .select({
      rumorId: rumorPlayers.rumorId,
      playerId: rumorPlayers.playerId,
      isPrimary: rumorPlayers.isPrimary,
      fromTeamId: rumorPlayers.fromTeamId,
      toTeamId: rumorPlayers.toTeamId,
      slug: players.slug,
      fullName: players.fullName,
      nbaPlayerId: players.nbaPlayerId,
      prominence: players.prominence,
    })
    .from(rumorPlayers)
    .innerJoin(players, eq(players.id, rumorPlayers.playerId))
    .where(sql`${rumorPlayers.rumorId} in ${ids}`);

  /*
   * All 30 rows, once. A player's from/to team is usually tagged on the post
   * as well, but not always — a player can be described as leaving a team the
   * item never names as involved — so resolving against the post's own tags
   * would drop those arrows.
   */
  const allTeams = await db.select({ id: teams.id, abbreviation: teams.abbreviation }).from(teams);
  const abbrevById = new Map(allTeams.map((t) => [t.id, t.abbreviation]));

  const stories = await storiesPerPlayer();

  return rows.map((r) => {
    const mine = playerRows.filter((p) => p.rumorId === r.id);
    const primary = mine.find((p) => p.isPrimary) ?? mine[0];
    return {
      ...r,
      /*
       * Stories, not posts. The SQL count treats every row as a separate
       * report, and one signing routinely exists as five or six of them —
       * Klay Thompson showed "10 reports this week" for what was four stories.
       * The badge is meant to say a player is generating coverage, not that we
       * filed the same report six times.
       */
      hotMentions: r.hotMentions > 0 ? (stories.get(primary?.playerId ?? -1) ?? 0) : 0,
      /*
       * Image paths are derived here rather than read from a column, so they
       * describe the files this deploy actually carries. See lib/images.
       */
      teams: teamRows
        .filter((t) => t.rumorId === r.id)
        .sort((a, b) => TEAM_ROLE_ORDER[a.role] - TEAM_ROLE_ORDER[b.role])
        .map((t) => ({ ...t, logoUrl: logoFor(t.nbaTeamId) })),
      players: mine.map((p) => ({
        ...p,
        headshotUrl: headshotFor(p.nbaPlayerId),
        fromAbbrev: p.fromTeamId ? (abbrevById.get(p.fromTeamId) ?? null) : null,
        toAbbrev: p.toTeamId ? (abbrevById.get(p.toTeamId) ?? null) : null,
      })),
    };
  });
}

/**
 * Distinct stories per player over the last week, keyed by player id.
 *
 * Counting distinct event keys would not do it: every key is unique, which is
 * exactly why the duplicates exist. They only collapse under the similarity
 * rule, which is JS rather than SQL — so this is one small query (tens of rows)
 * clustered in memory, rather than a subquery per feed row.
 */
async function storiesPerPlayer(): Promise<Map<number, number>> {
  const recent = await db
    .select({ playerId: rumorPlayers.playerId, eventKey: rumors.eventKey })
    .from(rumors)
    .innerJoin(
      rumorPlayers,
      sql`${rumorPlayers.rumorId} = ${rumors.id} and ${rumorPlayers.isPrimary}`,
    )
    .where(
      sql`${rumors.isPublished} and ${rumors.publishedAt} > now() - interval '7 days'`,
    );

  const keysByPlayer = new Map<number, string[]>();
  for (const row of recent) {
    if (!row.eventKey) continue;
    keysByPlayer.set(row.playerId, [
      ...(keysByPlayer.get(row.playerId) ?? []),
      row.eventKey,
    ]);
  }

  const counts = new Map<number, number>();
  for (const [playerId, keys] of keysByPlayer) {
    const clusters: string[][] = [];
    for (const key of keys) {
      const hit = clusters.find((c) => c.some((k) => isSameEvent(k, key)));
      if (hit) hit.push(key);
      else clusters.push([key]);
    }
    counts.set(playerId, clusters.length);
  }
  return counts;
}

/**
 * The three scoring pieces, defined once because the ordering needs the same
 * expressions the select does. Repeating them inline made the "top" ordering
 * a wall of duplicated subqueries.
 */
/**
 * How big a story is, by who it is about.
 *
 * The primary player carries it, plus a quarter of the best other name tagged.
 * Taking the plain maximum meant a Peyton Watson trade sorted as a Nikola
 * Jokic story purely because Jokic was mentioned — rated 100 when Watson is
 * 49. Taking the primary alone would drop it to 49 and lose the fact that a
 * Jokic-adjacent trade genuinely is more interesting than an ordinary one.
 *
 * A quarter splits it: that post lands at 74, above a routine Watson signing
 * and below a real Jokic story. Multi-player trades keep some lift from the
 * biggest name in them without being mistaken for stories about that name.
 */
const PROMINENCE = sql`(
  coalesce((
    select max(p.prominence) from rumor_players rp
    join players p on p.id = rp.player_id
    where rp.rumor_id = ${rumors.id} and rp.is_primary
  ), 0)
  + 0.25 * coalesce((
    select max(p.prominence) from rumor_players rp
    join players p on p.id = rp.player_id
    where rp.rumor_id = ${rumors.id} and not rp.is_primary
  ), 0)
)`;

const HOT = sql`(case when ${rumors.publishedAt} > now() - interval '7 days' then (
  select count(distinct r2.id)
  from rumor_players rp
  join rumor_players rp2 on rp2.player_id = rp.player_id
  join rumors r2 on r2.id = rp2.rumor_id
    and r2.is_published and r2.published_at > now() - interval '7 days'
  where rp.rumor_id = ${rumors.id} and rp.is_primary
) else 0 end)`;

/**
 * How much an outlet's word is worth, in ranking points.
 *
 * Not every byline carries the same weight, and our own data says so: of the
 * moves ESPN reports, 89% turn out to be completed deals, against 64% for CBS,
 * 50% for RealGM and 0% for heavy.com, Bleacher Report and the long tail of
 * aggregators. A national desk breaking a signing should outrank a mock-trade
 * blog writing about the same player.
 *
 * Resolved from the effective outlet, not the feed: three of our feeds are
 * Google News searches, so the source row says "Google News" while the actual
 * publisher underneath ranges from ESPN to bballrumors.com.
 *
 * Fifteen points is about one tier of prominence — enough to separate two
 * reports of the same story, not enough to lift a fringe signing over a star.
 * The long tail is docked eight rather than merely left at zero: rewarding the
 * national desks was not enough on the recency-weighted feed, where a fresh
 * mock-trade post still led the front page on the strength of its subject.
 * Basketball-Reference sits at zero deliberately: the transaction log is the
 * most reliable source we have and the least newsworthy, and 497 routine
 * filings must not crowd out reporting.
 */
const OUTLET_WEIGHT = sql`(case
  when ${sources.slug} = 'bbref-transactions' then 0
  when lower(coalesce(nullif(${feedItems.publisher}, ''), ${sources.name}))
    ~ '(espn|yahoo|realgm|theathletic|the athletic)' then 15
  when lower(coalesce(nullif(${feedItems.publisher}, ''), ${sources.name}))
    ~ '(cbssports|cbs sports|hoopsrumors|hoops rumors|bleacher|sports illustrated|usatoday|usa today|sportando|hoopshype)' then 8
  else -8 end)`;

const OUTLETS = sql`(
  select count(distinct case when s2.slug like 'gnews%'
    then coalesce(nullif(rs.publisher, ''), s2.name) else s2.name end)
  from rumor_sources rs join sources s2 on s2.id = rs.source_id
  where rs.rumor_id = ${rumors.id}
)`;

/** Rank decayed by age — the default feed order. */
const RANK = sql`(${PROMINENCE} + ${OUTLET_WEIGHT} - extract(epoch from (now() - ${rumors.publishedAt})) / 3600.0 * 1.2) desc`;

/**
 * "Top" means biggest story, not best-sourced one. Lives in SQL so it can be
 * paged — sorted in memory, page two was only ever ordering whichever 200 rows
 * the query happened to return.
 *
 * It used to sort on outlet count then confidence, but almost every post
 * carries exactly one outlet, so the tab was really "the handful of
 * corroborated posts, then everything else by a score that clusters at
 * 0.9-1.0". That put a Dillon Brooks extension above LeBron-to-Philadelphia
 * and a prominence-0 signing at number two.
 *
 * The weights, in order of how much work they do:
 * - prominence (0-100) is the base: who the story is about.
 * - hot mentions x3 is the strongest signal that something is THE story of the
 *   week. Thirteen posts about one player in seven days is the site telling us
 *   where the attention is, and it was being ignored entirely.
 * - corroboration is a bonus, not the sort key. One extra outlet is worth 12
 *   points, roughly a tier of prominence, so a well-sourced mid-tier story can
 *   beat a thin star rumor without steamrolling the ranking.
 * - confidence breaks ties; its range is too narrow to do more.
 *
 * Recency is deliberately absent — Latest is the chronological view and Live
 * is the decayed one, so duplicating either here would leave no view that
 * surfaces a big story once it is a few days old.
 */
/**
 * The biggest stories, with recency deliberately absent.
 *
 * Both volume terms are capped, because uncapped they stopped measuring
 * importance and started measuring how much was written. Jonathan Kuminga's
 * free agency generated 20 posts in a week, worth 60 points before the cap —
 * more than the entire gap between a fringe player and a superstar. So a
 * roundup noting he was still unsigned ranked 4th, above LeBron signing with
 * the 76ers at 20th, and "Kuminga said to favor Lakers" outranked most of the
 * league. How much is being written about a player says how busy his summer
 * is, not how big any one report is.
 *
 * Capped rather than deleted: a story genuinely everyone is chasing should
 * still get some lift, and removing the term outright let pure roundups about
 * famous players climb on prominence alone. Four posts is enough to show a
 * story has legs; the twentieth says nothing the fourth did not.
 *
 * The same argument caps corroboration. Three independent outlets means a
 * story is real; a fourth and fifth are the same fact again.
 */
/**
 * How far the move itself got, which Top ignored entirely.
 *
 * "Sabonis set to stay in Sacramento after trade talks stall" ranked 7th: a
 * move that is NOT happening, sitting among the biggest stories of the month,
 * carried there by Sabonis being rated 100. The ordering knew who a post was
 * about and nothing about whether anything happened.
 *
 * A completed deal is the biggest kind of story there is, so it leads. A
 * debunked one is the smallest — the news is that there is no news — and it is
 * docked hard enough to leave the front page whoever it concerns.
 *
 * Rumors are NOT penalised. Speculation is a large part of what this site is
 * for, and a well-sourced Kyrie Irving rumor deserves its place at the top.
 * The only thing being pushed down is the non-event.
 */
const STATUS_WEIGHT = sql`(case ${rumors.status}
  when 'completed' then 12
  when 'confirmed' then 12
  when 'reported' then 6
  when 'debunked' then -30
  else 0 end)`;

/**
 * Roundups are not stories, and Top is a list of stories.
 *
 * "Harden, Green among names left as free agency rolls on" tags three players
 * as its subject and no team as involved in anything. It ranked 20th on the
 * strength of James Harden being rated 100, which is the ordering answering a
 * question nobody asked: not "how big is this move" but "is a famous name
 * anywhere in this text".
 *
 * A post with more than one subject is a survey of several situations, and the
 * prominence it inherits belongs to whichever name in the list scores highest.
 * Docked enough to clear the front page without hiding it.
 */
const ROUNDUP_PENALTY = sql`(case when (
  select count(*) from rumor_players rp
  where rp.rumor_id = ${rumors.id} and rp.is_primary
) > 1 then -25 else 0 end)`;

const TOP = sql`(${PROMINENCE} + ${OUTLET_WEIGHT} + ${STATUS_WEIGHT} + ${ROUNDUP_PENALTY} + least(${HOT}, 4) * 3 + least(${OUTLETS} - 1, 3) * 12 + ${rumors.confidence} * 10) desc`;

export type FeedOrder = "rank" | "chrono" | "top";

/** Drizzle allows exactly one `.where()`, so extra filters are passed in. */
const baseSelect = (extra?: SQL, order: FeedOrder = "rank") =>
  db
    .select({
      id: rumors.id,
      slug: rumors.slug,
      headline: rumors.headline,
      body: rumors.body,
      type: rumors.type,
      status: rumors.status,
      confidence: rumors.confidence,
      reportedBy: rumors.reportedBy,
      /*
       * Credit the outlet that did the reporting, not the aggregator that
       * carried it. Three of our feeds are Google News searches, so a byline
       * of "Google News" was hiding Yahoo Sports, ESPN, Bleacher Report and
       * the rest behind a wire we do not read.
       *
       * Only for the aggregators. On a direct feed the publisher field holds
       * the bare domain the link resolved to — "espn.com" — which is a worse
       * byline than the source's own name.
       */
      sourceName: sql<string>`case
        when ${sources.slug} like 'gnews%'
        then coalesce(nullif(${feedItems.publisher}, ''), ${sources.name})
        else ${sources.name} end`,
      sourceSlug: sources.slug,
      contractValue: rumors.contractValue,
      contractYears: rumors.contractYears,
      outcome: rumors.outcome,
      outcomeAt: rumors.outcomeAt,
      sourceUrl: rumors.sourceUrl,
      publishedAt: rumors.publishedAt,
      bodyUpdatedAt: rumors.bodyUpdatedAt,
      imageUrl: playerImages.url,
      imageAttribution: playerImages.attribution,
      /** Distinct outlets that reported this event — the corroboration count. */
      sourceCount: sql<number>`(
        select count(distinct case when s2.slug like 'gnews%' then coalesce(nullif(rs.publisher, ''), s2.name) else s2.name end)::int
        from rumor_sources rs join sources s2 on s2.id = rs.source_id
        where rs.rumor_id = ${rumors.id}
      )`,
      alsoReportedBy: sql<string | null>`(
        select string_agg(distinct case when s2.slug like 'gnews%' then coalesce(nullif(rs.publisher, ''), s2.name) else s2.name end, ', ')
        from rumor_sources rs join sources s2 on s2.id = rs.source_id
        where rs.rumor_id = ${rumors.id}
      )`,
      /**
       * The corroboration chain: who reported what, newest first.
       *
       * It ran oldest first, on the reasoning that a chain is a sequence and
       * sequences start at the beginning. But nothing else on the site reads
       * that way — the feed, the team pages and the player pages are all
       * newest first — and the row a reader wants is the latest one, which was
       * buried at the bottom of a five-row list.
       */
      chain: sql<
        { outlet: string; headline: string; url: string; at: string }[]
      >`(
        select coalesce(json_agg(json_build_object(
          'outlet', case when s2.slug like 'gnews%' then coalesce(nullif(rs.publisher, ''), s2.name) else s2.name end, 'headline', rs.headline,
          'url', rs.source_url, 'at', rs.published_at
        ) order by rs.published_at desc), '[]'::json)
        from rumor_sources rs join sources s2 on s2.id = rs.source_id
        where rs.rumor_id = ${rumors.id}
      )`,
      /**
       * How many separate posts named this rumor's primary player in the last
       * week — momentum around the player, independent of this one report.
       *
       * Zero for posts older than that window. The number describes right now,
       * so on a piece from four weeks ago "13 reports this week" asserted
       * something untrue about itself. Gating it here rather than in the
       * component keeps render pure — Date.now() during render is impure and
       * gives unstable results across re-renders.
       */
      hotMentions: sql<number>`(
        case when ${rumors.publishedAt} > now() - interval '7 days' then (
          select count(distinct r2.id)::int
          from rumor_players rp
          join rumor_players rp2 on rp2.player_id = rp.player_id
          join rumors r2 on r2.id = rp2.rumor_id
            and r2.is_published
            and r2.published_at > now() - interval '7 days'
          where rp.rumor_id = ${rumors.id} and rp.is_primary
        ) else 0 end
      )`,
    })
    .from(rumors)
    .innerJoin(sources, eq(sources.id, rumors.sourceId))
    .leftJoin(playerImages, eq(playerImages.id, rumors.imageId))
    .leftJoin(feedItems, eq(feedItems.id, rumors.feedItemId))
    .where(extra ? and(eq(rumors.isPublished, true), extra) : eq(rumors.isPublished, true))
    /*
     * Rank = the most prominent player named, decayed by age. At 1.2 points
     * an hour, a LeBron rumor (≈89) outranks a fringe signing (≈5) for about
     * three days, then recency takes over — so the feed stays current without
     * burying the story everyone actually came for.
     *
     * Chronological drops all of that and orders purely by when a report
     * landed, which is what "Latest updates" promises: the wire as it came in,
     * with nothing weighted or reordered.
     */
    .orderBy(
      ...(order === "chrono"
        ? [desc(rumors.publishedAt)]
        : [order === "top" ? TOP : RANK, desc(rumors.publishedAt)]),
    );

/**
 * `chronological` must be applied in the query, not by re-sorting the result:
 * the limit selects which rows come back, so sorting a rank-selected page by
 * date would still be showing the rank-selected rows.
 */
export async function latestRumors(limit = 30, chronological = false) {
  return hydrate(await baseSelect(undefined, chronological ? "chrono" : "rank").limit(limit));
}

/**
 * One page of the main feed, filtered and ordered in the database.
 *
 * The page used to pull 200 rows and narrow them in memory, which capped the
 * whole archive at whatever those 200 happened to be: 582 of 622 posts had
 * URLs that nothing on the site linked to, under a line reading "End of the
 * feed". Filtering and ordering in SQL is what makes an offset mean anything.
 */
export async function feedPage(opts: {
  tab: string;
  cat: string;
  page: number;
  perPage: number;
}) {
  const { tab, cat, page, perPage } = opts;

  const filters: SQL[] = [];
  if (cat) filters.push(sql`${rumors.type} = ${cat}`);
  if (tab === "confirmed") {
    filters.push(sql`${rumors.status} in ('confirmed','completed')`);
  }
  const extra = filters.length ? and(...filters) : undefined;

  const order: FeedOrder =
    tab === "latest" ? "chrono" : tab === "top" ? "top" : "rank";

  const [rows, [counted]] = await Promise.all([
    baseSelect(extra, order)
      .limit(perPage)
      .offset((page - 1) * perPage),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(rumors)
      .where(
        extra ? and(eq(rumors.isPublished, true), extra) : eq(rumors.isPublished, true),
      ),
  ]);

  const total = counted?.n ?? 0;
  return {
    rumors: await hydrate(rows),
    total,
    pageCount: Math.max(1, Math.ceil(total / perPage)),
  };
}

/**
 * One post, fetched by slug.
 *
 * The rumor page used to pull the top 200 of the ranked feed and look for the
 * post inside it, so anything older than the current window 404'd even though
 * it was published and listed in the sitemap — around 430 of 631 posts. Age is
 * not a reason a page should stop existing.
 */
export async function rumorBySlug(slug: string) {
  const rows = await baseSelect(sql`${rumors.slug} = ${slug}`).limit(1);
  const [rumor] = await hydrate(rows);
  return rumor ?? null;
}

/*
 * A team or player page is a timeline, so it reads newest first.
 *
 * The ranked order these used belongs on the front page, where the question is
 * "what matters across the league right now" and a fringe signing should not
 * outrank a star's. On one player's page every post is already about them, so
 * prominence is a constant and all the ordering did was shuffle their story
 * out of sequence: a three-week-old trade rumour could sit above the signing
 * that resolved it.
 */
/**
 * Ten to a page.
 *
 * These pages used to take 30 and stop, with nothing to say that a 31st
 * existed — a heavily covered team simply truncated, and these are the pages
 * people arrive on from search. Ten is a page you can read to the bottom;
 * beyond that the reader is scrolling past a story rather than choosing it.
 */
const PER_PAGE = 10;

/**
 * One page of a team's or player's coverage, with the count needed to page
 * through the rest.
 *
 * The count is a second query rather than a window function because the id
 * subquery already narrows to a few dozen rows, and counting them is cheaper
 * than carrying a total on every hydrated row.
 */
async function pageOf(ids: SQL, page: number) {
  const [rows, [counted]] = await Promise.all([
    baseSelect(sql`${rumors.id} in ${ids}`, "chrono")
      .limit(PER_PAGE)
      .offset((page - 1) * PER_PAGE),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(rumors)
      .where(and(eq(rumors.isPublished, true), sql`${rumors.id} in ${ids}`)),
  ]);

  const total = counted?.n ?? 0;
  return {
    rumors: await hydrate(rows),
    total,
    pageCount: Math.max(1, Math.ceil(total / PER_PAGE)),
  };
}

export async function rumorsForTeam(teamSlug: string, page = 1) {
  const ids = db
    .select({ id: rumorTeams.rumorId })
    .from(rumorTeams)
    .innerJoin(teams, eq(teams.id, rumorTeams.teamId))
    .where(eq(teams.slug, teamSlug));
  return pageOf(ids as unknown as SQL, page);
}

export async function rumorsForPlayer(playerSlug: string, page = 1) {
  const ids = db
    .select({ id: rumorPlayers.rumorId })
    .from(rumorPlayers)
    .innerJoin(players, eq(players.id, rumorPlayers.playerId))
    .where(eq(players.slug, playerSlug));
  return pageOf(ids as unknown as SQL, page);
}

/**
 * Everyone on an NBA roster this season, alphabetical by first name.
 * Inactive names — retired players and others that only ever showed up in a
 * rumor — are excluded from the directory but keep their own pages.
 */
export async function allPlayers() {
  /*
   * Active players plus anyone we have actually published a rumor about.
   *
   * is_active alone means "on a roster at the last sync", which quietly hid
   * the players most worth reading about: Ben Simmons was on the front page
   * being watched by a Kings scout and missing from this list, one of 118 in
   * that state with Kyrie Irving among them. If we wrote about him, he is a
   * player we track.
   */
  const rows = await db
    .select({
      slug: players.slug,
      fullName: players.fullName,
      nbaPlayerId: players.nbaPlayerId,
      prominence: players.prominence,
    })
    .from(players)
    .where(
      sql`${players.isActive} or exists (
        select 1 from rumor_players rp
          join rumors r on r.id = rp.rumor_id and r.is_published
         where rp.player_id = ${players.id}
      )`,
    )
    .orderBy(players.fullName);

  return rows.map((p) => ({ ...p, headshotUrl: headshotFor(p.nbaPlayerId) }));
}

/** Counts per rumor type — the left rail's "Beats" list. */
export async function beatCounts() {
  return db
    .select({ type: rumors.type, n: sql<number>`count(*)::int` })
    .from(rumors)
    .where(eq(rumors.isPublished, true))
    .groupBy(rumors.type)
    .orderBy(sql`count(*) desc`);
}

/** Teams with the most activity, for the left rail's team filter. */
export async function activeTeams(limit = 12) {
  return db
    .select({
      slug: teams.slug,
      abbreviation: teams.abbreviation,
      n: sql<number>`count(*)::int`,
    })
    .from(rumorTeams)
    .innerJoin(teams, eq(teams.id, rumorTeams.teamId))
    .innerJoin(
      rumors,
      sql`${rumors.id} = ${rumorTeams.rumorId} and ${rumors.isPublished}`,
    )
    .groupBy(teams.slug, teams.abbreviation)
    .orderBy(sql`count(*) desc`)
    .limit(limit);
}

/**
 * Most-talked-about players over the last week. This replaces the concept's
 * "Insider Board", which needed hit-rate data we do not have.
 */
export async function mostMentioned(limit = 6) {
  const rows = await db
    .select({
      slug: players.slug,
      fullName: players.fullName,
      nbaPlayerId: players.nbaPlayerId,
      prominence: players.prominence,
      mentions: sql<number>`count(*)::int`,
      lastAt: sql<string>`max(${rumors.publishedAt})`,
    })
    .from(rumorPlayers)
    .innerJoin(players, eq(players.id, rumorPlayers.playerId))
    .innerJoin(
      rumors,
      sql`${rumors.id} = ${rumorPlayers.rumorId} and ${rumors.isPublished}`,
    )
    .where(sql`${rumors.publishedAt} > now() - interval '7 days'`)
    .groupBy(players.slug, players.fullName, players.nbaPlayerId, players.prominence)
    .orderBy(sql`count(*) desc, max(${rumors.publishedAt}) desc`)
    .limit(limit);

  return rows.map((p) => ({ ...p, headshotUrl: headshotFor(p.nbaPlayerId) }));
}

/** Genuinely completed moves — the ticker, without inventing transactions. */
export async function recentlyDone(limit = 6) {
  return db
    .select({
      slug: rumors.slug,
      headline: rumors.headline,
      type: rumors.type,
    })
    .from(rumors)
    .where(
      and(
        eq(rumors.isPublished, true),
        sql`${rumors.status} in ('completed','confirmed')`,
      ),
    )
    .orderBy(desc(rumors.publishedAt))
    .limit(limit);
}

/** Honest counters for the left rail, in place of a fake cap sheet. */
export async function wireStats() {
  const [row] = await db
    .select({
      rumorCount: sql<number>`(select count(*)::int from rumors where is_published)`,
      outletCount: sql<number>`(select count(distinct name)::int from sources where enabled)`,
      playerCount: sql<number>`(select count(distinct player_id)::int from rumor_players)`,
      corroborated: sql<number>`(
        select count(*)::int from (
          select r.id from rumors r join rumor_sources rs on rs.rumor_id = r.id
          where r.is_published group by r.id having count(distinct rs.source_id) > 1
        ) t)`,
    })
    .from(sources)
    .limit(1);
  return row;
}

export async function allTeams() {
  const rows = await db.select().from(teams).orderBy(teams.conference, teams.city);
  return rows.map((t) => ({ ...t, logoUrl: logoFor(t.nbaTeamId) }));
}

export async function teamBySlug(slug: string) {
  const [t] = await db.select().from(teams).where(eq(teams.slug, slug)).limit(1);
  return t ? { ...t, logoUrl: logoFor(t.nbaTeamId) } : null;
}

export async function playerBySlug(slug: string) {
  const [p] = await db.select().from(players).where(eq(players.slug, slug)).limit(1);
  return p ? { ...p, headshotUrl: headshotFor(p.nbaPlayerId) } : null;
}

/**
 * The surviving slug for a retired one, or null.
 *
 * Only consulted when a player page misses, so the ordinary request pays
 * nothing for it.
 */
export async function playerRedirectFor(slug: string): Promise<string | null> {
  const [row] = await db
    .select({ slug: players.slug })
    .from(playerSlugRedirects)
    .innerJoin(players, eq(players.id, playerSlugRedirects.playerId))
    .where(eq(playerSlugRedirects.fromSlug, slug))
    .limit(1);
  return row?.slug ?? null;
}
