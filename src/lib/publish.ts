import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  feedItems,
  playerImages,
  players,
  rumorPlayers,
  rumorTeams,
  rumors,
  teams,
} from "@/db/schema";
import type { Extraction } from "@/lib/extract";
import { findCommonsImages, preferLandscape } from "@/lib/images";

/** Below this, hold the rumor back for review instead of publishing. */
const PUBLISH_THRESHOLD = 0.6;

const slugify = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);

/** Match on the normalized name so "Luka Dončić" and "Luka Doncic" collapse. */
const normalizeName = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

async function resolvePlayer(name: string): Promise<number | null> {
  const clean = name.trim();
  if (clean.length < 3) return null;
  const slug = slugify(clean);

  const [existing] = await db
    .select({ id: players.id })
    .from(players)
    .where(eq(players.slug, slug))
    .limit(1);
  if (existing) return existing.id;

  // Extraction met a name we haven't seen — grow the tag vocabulary.
  const [created] = await db
    .insert(players)
    .values({ slug, fullName: clean, aliases: [normalizeName(clean)] })
    .onConflictDoUpdate({
      target: players.slug,
      set: { fullName: sql`excluded.full_name` },
    })
    .returning({ id: players.id });
  return created?.id ?? null;
}

/**
 * Fetch a usable photo for a player we don't have one for yet. Best-effort:
 * a missing image degrades the card to team logos, it doesn't fail the publish.
 */
async function ensurePlayerImage(playerId: number, fullName: string) {
  const [existing] = await db
    .select({ id: playerImages.id })
    .from(playerImages)
    .where(eq(playerImages.playerId, playerId))
    .limit(1);
  if (existing) return existing.id;

  try {
    const candidates = (await findCommonsImages(fullName)).sort(preferLandscape);
    const best = candidates[0];
    if (!best) return null;

    const [created] = await db
      .insert(playerImages)
      .values({
        playerId,
        kind: "action",
        url: best.url,
        width: best.width,
        height: best.height,
        license: best.license,
        attribution: best.attribution,
        attributionUrl: best.attributionUrl,
        sourceUrl: best.sourceUrl,
        isPrimary: true,
      })
      .onConflictDoNothing({ target: playerImages.url })
      .returning({ id: playerImages.id });
    return created?.id ?? null;
  } catch {
    return null;
  }
}

export type PublishResult =
  | { status: "published"; rumorId: number }
  | { status: "held"; rumorId: number }
  | { status: "rejected"; reason: string };

/** Turn one extraction into a rumor row plus its team and player tags. */
export async function publishExtraction(
  item: { id: number; sourceId: number; url: string; publishedAt: Date },
  extraction: Extraction,
): Promise<PublishResult> {
  if (!extraction.isRumor || extraction.confidence < 0.35) {
    const reason = extraction.rejectedReason ?? "not a transfer story";
    await db
      .update(feedItems)
      .set({ processedAt: new Date(), rejectedReason: reason })
      .where(eq(feedItems.id, item.id));
    return { status: "rejected", reason };
  }

  const isPublished = extraction.confidence >= PUBLISH_THRESHOLD;

  const [rumor] = await db
    .insert(rumors)
    .values({
      slug: `${slugify(extraction.headline)}-${item.id}`,
      headline: extraction.headline,
      body: extraction.body,
      type: extraction.type,
      status: extraction.status,
      confidence: extraction.confidence,
      reportedBy: extraction.reportedBy?.slice(0, 128) ?? null,
      sourceId: item.sourceId,
      feedItemId: item.id,
      sourceUrl: item.url,
      publishedAt: item.publishedAt,
      isPublished,
    })
    .onConflictDoNothing({ target: rumors.feedItemId })
    .returning({ id: rumors.id });

  if (!rumor) {
    // Already published by a concurrent run.
    await db
      .update(feedItems)
      .set({ processedAt: new Date() })
      .where(eq(feedItems.id, item.id));
    return { status: "rejected", reason: "already processed" };
  }

  // Team tags — ignore abbreviations the model invented.
  const abbrevs = [...new Set(extraction.teams.map((t) => t.abbreviation))];
  if (abbrevs.length > 0) {
    const rows = await db
      .select({ id: teams.id, abbreviation: teams.abbreviation })
      .from(teams);
    const byAbbrev = new Map(rows.map((r) => [r.abbreviation, r.id]));

    const links: { rumorId: number; teamId: number; role: string }[] = [];
    const seen = new Set<number>();
    for (const t of extraction.teams) {
      const teamId = byAbbrev.get(t.abbreviation);
      if (teamId == null || seen.has(teamId)) continue;
      seen.add(teamId);
      links.push({ rumorId: rumor.id, teamId, role: t.role });
    }
    if (links.length > 0) {
      await db.insert(rumorTeams).values(links).onConflictDoNothing();
    }
  }

  // Player tags, and the card image for the primary player.
  let imageId: number | null = null;
  for (const p of extraction.players.slice(0, 8)) {
    const playerId = await resolvePlayer(p.name);
    if (playerId == null) continue;

    await db
      .insert(rumorPlayers)
      .values({ rumorId: rumor.id, playerId, isPrimary: p.isPrimary })
      .onConflictDoNothing();

    if (p.isPrimary && imageId == null) {
      imageId = await ensurePlayerImage(playerId, p.name);
    }
  }

  if (imageId != null) {
    await db.update(rumors).set({ imageId }).where(eq(rumors.id, rumor.id));
  }

  await db
    .update(feedItems)
    .set({ processedAt: new Date() })
    .where(eq(feedItems.id, item.id));

  return { status: isPublished ? "published" : "held", rumorId: rumor.id };
}

/** Unprocessed items, newest first. */
export async function pendingItems(limit: number) {
  return db
    .select({
      id: feedItems.id,
      sourceId: feedItems.sourceId,
      url: feedItems.url,
      title: feedItems.title,
      rawSummary: feedItems.rawSummary,
      publisher: feedItems.publisher,
      publishedAt: feedItems.publishedAt,
    })
    .from(feedItems)
    .where(and(sql`${feedItems.processedAt} is null`))
    .orderBy(sql`${feedItems.publishedAt} desc`)
    .limit(limit);
}
