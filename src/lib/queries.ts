import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  feedItems,
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
  maxProminence: number;
  hotMentions: number;
  confidence: number;
  teams: {
    slug: string;
    abbreviation: string;
    city: string;
    name: string;
    logoUrl: string;
    primaryColor: string;
    role: string;
  }[];
  players: {
    slug: string;
    fullName: string;
    isPrimary: boolean;
    headshotUrl: string | null;
  }[];
};

/**
 * One query for the cards plus two for the tags, then stitched in memory —
 * cheaper than a triple join that fans out rows per tag.
 */
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
      logoUrl: teams.logoUrl,
      primaryColor: teams.primaryColor,
    })
    .from(rumorTeams)
    .innerJoin(teams, eq(teams.id, rumorTeams.teamId))
    .where(sql`${rumorTeams.rumorId} in ${ids}`);

  const playerRows = await db
    .select({
      rumorId: rumorPlayers.rumorId,
      isPrimary: rumorPlayers.isPrimary,
      slug: players.slug,
      fullName: players.fullName,
      headshotUrl: players.headshotUrl,
    })
    .from(rumorPlayers)
    .innerJoin(players, eq(players.id, rumorPlayers.playerId))
    .where(sql`${rumorPlayers.rumorId} in ${ids}`);

  return rows.map((r) => ({
    ...r,
    teams: teamRows
      .filter((t) => t.rumorId === r.id)
      // "from" before "to" so the card reads like the trade direction.
      .sort((a, b) => (a.role === "from" ? -1 : b.role === "from" ? 1 : 0)),
    players: playerRows.filter((p) => p.rumorId === r.id),
  }));
}

/** Drizzle allows exactly one `.where()`, so extra filters are passed in. */
const baseSelect = (extra?: SQL) =>
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
      /** The corroboration chain: who reported what, oldest first. */
      chain: sql<
        { outlet: string; headline: string; url: string; at: string }[]
      >`(
        select coalesce(json_agg(json_build_object(
          'outlet', case when s2.slug like 'gnews%' then coalesce(nullif(rs.publisher, ''), s2.name) else s2.name end, 'headline', rs.headline,
          'url', rs.source_url, 'at', rs.published_at
        ) order by rs.published_at), '[]'::json)
        from rumor_sources rs join sources s2 on s2.id = rs.source_id
        where rs.rumor_id = ${rumors.id}
      )`,
      /** Highest prominence among the players named — drives the hype badge. */
      maxProminence: sql<number>`(
        select coalesce(max(p.prominence), 0)::int
        from rumor_players rp join players p on p.id = rp.player_id
        where rp.rumor_id = ${rumors.id}
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
     */
    .orderBy(
      sql`(
        coalesce((
          select max(p.prominence) from rumor_players rp
          join players p on p.id = rp.player_id
          where rp.rumor_id = ${rumors.id}
        ), 0)
        - extract(epoch from (now() - ${rumors.publishedAt})) / 3600.0 * 1.2
      ) desc`,
      desc(rumors.publishedAt),
    );

export async function latestRumors(limit = 30) {
  return hydrate(await baseSelect().limit(limit));
}

export async function rumorsForTeam(teamSlug: string, limit = 30) {
  const ids = db
    .select({ id: rumorTeams.rumorId })
    .from(rumorTeams)
    .innerJoin(teams, eq(teams.id, rumorTeams.teamId))
    .where(eq(teams.slug, teamSlug));
  return hydrate(await baseSelect(sql`${rumors.id} in ${ids}`).limit(limit));
}

export async function rumorsForPlayer(playerSlug: string, limit = 30) {
  const ids = db
    .select({ id: rumorPlayers.rumorId })
    .from(rumorPlayers)
    .innerJoin(players, eq(players.id, rumorPlayers.playerId))
    .where(eq(players.slug, playerSlug));
  return hydrate(await baseSelect(sql`${rumors.id} in ${ids}`).limit(limit));
}

/**
 * Everyone on an NBA roster this season, alphabetical by first name.
 * Inactive names — retired players and others that only ever showed up in a
 * rumor — are excluded from the directory but keep their own pages.
 */
export async function allPlayers() {
  return db
    .select({
      slug: players.slug,
      fullName: players.fullName,
      headshotUrl: players.headshotUrl,
      prominence: players.prominence,
    })
    .from(players)
    .where(eq(players.isActive, true))
    .orderBy(players.fullName);
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
  return db
    .select({
      slug: players.slug,
      fullName: players.fullName,
      headshotUrl: players.headshotUrl,
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
    .groupBy(players.slug, players.fullName, players.headshotUrl, players.prominence)
    .orderBy(sql`count(*) desc, max(${rumors.publishedAt}) desc`)
    .limit(limit);
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
  return db.select().from(teams).orderBy(teams.conference, teams.city);
}

export async function teamBySlug(slug: string) {
  const [t] = await db.select().from(teams).where(eq(teams.slug, slug)).limit(1);
  return t ?? null;
}

export async function playerBySlug(slug: string) {
  const [p] = await db.select().from(players).where(eq(players.slug, slug)).limit(1);
  return p ?? null;
}
