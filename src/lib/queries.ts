import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
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
  teams: { slug: string; abbreviation: string; city: string; name: string; logoUrl: string; role: string }[];
  players: { slug: string; fullName: string; isPrimary: boolean }[];
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
      reportedBy: rumors.reportedBy,
      sourceName: sources.name,
      sourceUrl: rumors.sourceUrl,
      publishedAt: rumors.publishedAt,
      imageUrl: playerImages.url,
      imageAttribution: playerImages.attribution,
    })
    .from(rumors)
    .innerJoin(sources, eq(sources.id, rumors.sourceId))
    .leftJoin(playerImages, eq(playerImages.id, rumors.imageId))
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

/** Alphabetical by first name — how people scan a roster list. */
export async function allPlayers() {
  return db
    .select({
      slug: players.slug,
      fullName: players.fullName,
      headshotUrl: players.headshotUrl,
      prominence: players.prominence,
    })
    .from(players)
    .orderBy(players.fullName);
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
