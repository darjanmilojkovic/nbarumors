import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  feedItems,
  sources,
  playerImages,
  players,
  rumorPlayers,
  rumorSources,
  rumorTeams,
  rumors,
  teams,
} from "@/db/schema";
import { enrichBody } from "@/lib/enrich";
import { isSameEvent } from "@/lib/event-key";
import { sameStory } from "@/lib/same-story";
import { pruneStaleTags } from "@/lib/tags";
import type { Extraction } from "@/lib/extract";
import { findCommonsImages, preferLandscape } from "@/lib/images";

/** Below this, hold the rumor back for review instead of publishing. */
const PUBLISH_THRESHOLD = 0.6;

/**
 * When a settled post is short enough to count as a stub, and how much
 * corroboration it takes before that is worth acting on.
 *
 * 240 characters is about one sentence. The extraction prompt asks for "one to
 * four original sentences ... as many as the available facts justify and no
 * more", so a single sentence is the right answer to a headline-only item and
 * the wrong one to a story three outlets thought worth covering.
 *
 * Measured against the archive: of 571 settled posts, 32 carry three or more
 * outlets and exactly one of those is under 240 characters. This is a narrow
 * repair, not a general re-opening of finished posts.
 */
const STUB_CHARS = 240;
const STUB_OUTLETS = 3;

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

  /*
   * The slug missed, but the name may still be one we know under another
   * spelling: "Bobby Portis Jr." and "Bobby Portis" slugify apart while both
   * sit in the aliases of the single row the merge left behind. Without this
   * the extraction opens a second page for a player who already has one, and
   * his rumors and his rating split across the two.
   */
  const [byAlias] = await db
    .select({ id: players.id })
    .from(players)
    .where(sql`${normalizeName(clean)} = any(${players.aliases})`)
    .limit(1);
  if (byAlias) return byAlias.id;

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

/** How firm a report is; a later, firmer source upgrades the post. */
const STATUS_RANK: Record<string, number> = {
  rumor: 0,
  reported: 1,
  confirmed: 2,
  completed: 3,
  debunked: 4,
};

/** Events reported more than this long apart are treated as separate. */
const MERGE_WINDOW_DAYS = 14;

/**
 * How far back a settled transaction still counts as the same event.
 *
 * Fourteen days is right for a live rumour: two reports a month apart about a
 * player's future are usually two different stories. It is wrong for a done
 * deal, which stays the same event forever. LeBron signing for Philadelphia on
 * 24 July was reported again on 26 August — 33 days later, key
 * "lebron-james-phi-signing" against the original's
 * "lebron-james-phi-signing-multiyear" — and became a second post announcing a
 * month-old signing as news.
 *
 * Ninety days lets later coverage attach to the story it belongs to. Only for
 * events already recorded as done: an open rumour keeps the tighter window,
 * because that is where two months genuinely does mean two stories.
 */
const SETTLED_WINDOW_DAYS = 90;
const SETTLED = ["confirmed", "completed"];

/*
 * How recent a same-subject post must be before the model is asked whether it
 * is the same story. Two days is one news cycle; past that, two reports about
 * a player are usually two developments.
 */
const ADJUDICATE_WINDOW_HOURS = 48;

/**
 * Find an existing post for the same event. Keyed on the model's canonical
 * event key, which is why four outlets on one signing collapse while four
 * different angles on one player's free agency stay separate.
 */
async function findExistingEvent(
  eventKey: string,
  publishedAt: Date,
  subject: { headline: string; body: string; type: string; primaries: string[] },
) {
  const key = eventKey.trim().toLowerCase();
  if (!key) return null;

  /*
   * Look back as far as the settled window, then let each candidate decide
   * which limit applies to it — a done deal keeps the long reach, an open
   * rumour is held to fourteen days.
   */
  const since = new Date(publishedAt.getTime() - SETTLED_WINDOW_DAYS * 86_400_000);
  const until = new Date(publishedAt.getTime() + MERGE_WINDOW_DAYS * 86_400_000);

  /*
   * Every key in the window, compared in memory rather than matched in SQL.
   *
   * Exact equality missed two outlets that described one event in slightly
   * different words — "duren-kuminga-mathurin-free-agency-market-roundup" and
   * "duren-kuminga-mathurin-remaining-free-agents-roundup", filed two minutes
   * apart, became two posts. The window holds tens of rows, so scanning it is
   * cheaper than the duplicate it prevents.
   */
  const candidates = await db
    .select({
      id: rumors.id,
      status: rumors.status,
      confidence: rumors.confidence,
      publishedAt: rumors.publishedAt,
      eventKey: rumors.eventKey,
      type: rumors.type,
      sourceSlug: sources.slug,
      contractValue: rumors.contractValue,
      contractYears: rumors.contractYears,
      headline: rumors.headline,
      body: rumors.body,
    })
    .from(rumors)
    .innerJoin(sources, eq(sources.id, rumors.sourceId))
    .where(sql`${rumors.publishedAt} between ${since} and ${until}`)
    .orderBy(sql`${rumors.publishedAt} asc`);

  // Earliest match wins, so a story always collapses onto its first report.
  const existing = candidates.find((c) => {
    if (!c.eventKey || !isSameEvent(c.eventKey, key)) return false;
    const daysApart =
      Math.abs(publishedAt.getTime() - c.publishedAt.getTime()) / 86_400_000;
    const limit = SETTLED.includes(c.status)
      ? SETTLED_WINDOW_DAYS
      : MERGE_WINDOW_DAYS;
    return daysApart <= limit;
  });
  if (existing) return existing;

  /*
   * No key matched. Before filing a second post, check whether one about the
   * same player, of the same kind, landed in the last two days — and if so ask
   * whether it is the same story.
   *
   * Keys cannot answer this. Three reports on Nikola Jovic's trade value, all
   * Jake Fischer, all on one day, scored 0.44, 0.20 and 0.15 against a 0.50
   * threshold because one angle named Klay Thompson and another Bobby Portis.
   * Lowering the threshold to catch them also merges two LeBron columns filed
   * the same afternoon, and no string score tells those apart.
   */
  if (!subject.primaries.length) return null;

  const recent = candidates.filter((c) => {
    const hours = Math.abs(publishedAt.getTime() - c.publishedAt.getTime()) / 3_600_000;
    return hours <= ADJUDICATE_WINDOW_HOURS && c.type === subject.type;
  });
  if (!recent.length) return null;

  const sameSubject = await db
    .select({ rumorId: rumorPlayers.rumorId, slug: players.slug })
    .from(rumorPlayers)
    .innerJoin(players, eq(players.id, rumorPlayers.playerId))
    .where(
      sql`${rumorPlayers.rumorId} in ${recent.map((c) => c.id)} and ${rumorPlayers.isPrimary}`,
    );

  const primariesByRumor = new Map<number, string[]>();
  for (const row of sameSubject) {
    primariesByRumor.set(row.rumorId, [
      ...(primariesByRumor.get(row.rumorId) ?? []),
      row.slug,
    ]);
  }
  const wanted = [...subject.primaries].sort().join(",");

  for (const c of recent) {
    const theirs = (primariesByRumor.get(c.id) ?? []).sort().join(",");
    if (!theirs || theirs !== wanted) continue;
    if (await sameStory({ headline: c.headline, body: c.body }, subject)) return c;
  }

  return null;
}

/** Attach this report to an existing post instead of creating a duplicate. */
async function attachSource(
  rumorId: number,
  current: {
    status: string;
    confidence: number;
    publishedAt: Date;
    sourceSlug: string;
    contractValue: string | null;
    contractYears: number | null;
    headline: string;
    body: string;
  },
  item: {
    id: number;
    sourceId: number;
    url: string;
    title: string;
    publisher: string | null;
    publishedAt: Date;
    sourceSlug: string;
  },
  extraction: Extraction,
) {
  await db
    .insert(rumorSources)
    .values({
      rumorId,
      sourceId: item.sourceId,
      feedItemId: item.id,
      sourceUrl: item.url,
      publisher: item.publisher,
      reportedBy: extraction.reportedBy?.slice(0, 128) ?? null,
      headline: extraction.headline,
      publishedAt: item.publishedAt,
    })
    .onConflictDoNothing({ target: rumorSources.feedItemId });

  // Independent corroboration raises confidence and can firm up the status,
  // but never walks a confirmed deal back to a rumor.
  const status =
    STATUS_RANK[extraction.status] > STATUS_RANK[current.status]
      ? extraction.status
      : (current.status as Extraction["status"]);

  /*
   * Grow the summary when the story is still moving.
   *
   * An open rumour is a story in progress: three reports on Nikola Jovic's
   * trade value carried the Dallas sweetener demand, the Charlotte and
   * Brooklyn scenarios and his extension figure between them, and whichever
   * arrived first kept the post while the rest became chain entries.
   *
   * A settled deal is left alone. Once a move is done its summary is finished,
   * and a URL someone shared should not keep changing under them — with one
   * exception: a corrected figure. That is not new colour on a live story, it
   * is the post being wrong, which the Klay Thompson deal was for three days
   * at $13M while five later reports in its own chain said $11.5M.
   */
  const correctsTerms = Boolean(
    extraction.contractValue &&
      current.contractValue &&
      extraction.contractValue !== current.contractValue,
  );
  const open = current.status === "rumor" || current.status === "reported";

  /*
   * A settled post that is still only one sentence long, on a story several
   * outlets have covered.
   *
   * Freezing a completed deal is right in general, but it has a blind spot:
   * which report happened to arrive first. "Josh Green heads to Utah as
   * Williams and Konchar go to Minnesota" was born from ESPN's bare wire
   * alert — "Minnesota is sending Josh Green and cash to Utah for Cody
   * Williams and John Konchar, sources told ESPN", 103 characters — and stayed
   * that length while nine more outlets attached, several carrying the reason
   * it happened: Green's $14.7M coming off the books cleared Minnesota's
   * hard-cap room for Kuminga. None of it could reach the summary, because the
   * post was complete from its first word.
   *
   * Both halves of the test matter. A one-sentence body is often correct — a
   * headline-only item deserves one sentence and no more — so shortness alone
   * proves nothing. It is shortness AND three or more outlets that says the
   * story outgrew the report we filed it from.
   *
   * Self-limiting: enrichment pushes the body past the threshold, and
   * enrichBody already returns null when the incoming report adds nothing.
   */
  const [{ n: outletCount }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(rumorSources)
    .where(eq(rumorSources.rumorId, rumorId));

  const stub = current.body.length < STUB_CHARS && outletCount >= STUB_OUTLETS;

  const enriched =
    open || correctsTerms || stub
      ? await enrichBody({
          headline: current.headline,
          current: current.body,
          incoming: extraction.body,
          incomingOutlet: item.publisher ?? item.sourceSlug,
        })
      : null;

  /*
   * A league transaction record proves a move happened; it cannot tell the
   * story. Its entire text is a line like "Official transaction record. Teams:
   * PHI. Players: LeBron James." — 63 characters — so the biggest signing of
   * the offseason was summarised as a filing note, because merging keeps the
   * earliest report and for a completed deal that is always the log entry.
   *
   * When actual reporting arrives on a story we only had from the log, it
   * takes over the headline and body. The post keeps its URL, its date and its
   * place in the feed; it just stops being written by a clerk.
   */
  const fromLog = current.sourceSlug === "bbref-transactions";
  const upgrading = fromLog && item.sourceSlug !== "bbref-transactions";

  await db
    .update(rumors)
    .set({
      status,
      confidence: Math.min(1, Math.max(current.confidence, extraction.confidence) + 0.05),
      /*
       * The grown summary, and the stamp that says the post has moved on since
       * it was filed. An upgrade off the transaction log sets the body below
       * and wins, since replacing a clerk's filing note beats extending it.
       */
      ...(enriched && !(current.sourceSlug === "bbref-transactions")
        ? { body: enriched, bodyUpdatedAt: new Date() }
        : {}),
      /*
       * Terms come across from ANY later report, not only from an upgrade off
       * the transaction log. Outlets split the work: one files that a signing
       * happened and another files what it is worth, and keeping only the
       * first post's side left the DeRozan signing saying no financial terms
       * were included while the RealGM item attached to it said one year,
       * $3.9M. A figure we did not have is new information whoever sends it.
       */
      ...(!current.contractValue && extraction.contractValue
        ? { contractValue: extraction.contractValue.slice(0, 24) }
        : {}),
      ...(!current.contractYears && extraction.contractYears
        ? { contractYears: extraction.contractYears }
        : {}),
      ...(upgrading
        ? {
            /*
             * The body always comes across — that is the point. The headline
             * only if the incoming report is at least as settled, because a
             * log entry's "signs multi-year deal" is a better headline for a
             * done deal than an earlier "reportedly headed to Philadelphia".
             */
            ...(STATUS_RANK[extraction.status] >= STATUS_RANK[current.status]
              ? { headline: extraction.headline }
              : {}),
            body: extraction.body,
            sourceId: item.sourceId,
            sourceUrl: item.url,
            reportedBy: extraction.reportedBy?.slice(0, 128) ?? null,
            feedItemId: item.id,
            // Terms the log never carried.
            ...(extraction.contractValue ? { contractValue: extraction.contractValue } : {}),
            ...(extraction.contractYears ? { contractYears: extraction.contractYears } : {}),
          }
        : {}),
      /*
       * publishedAt deliberately untouched.
       *
       * It used to advance to whichever report was newest, to keep a story
       * surfacing while outlets picked it up. But the card shows that date
       * beside a byline linking to one specific article, so a story that broke
       * on 21 August read "12h ago" next to a link to a five-day-old CBS
       * piece. It also let old stories jump to the top of the chronological
       * tab, and shifted them inside the seven-day window that decides which
       * players count as generating coverage.
       *
       * The date now means when this story broke. How much attention it is
       * still getting is what the corroboration count and the momentum badge
       * are for.
       */
    })
    .where(eq(rumors.id, rumorId));

  /*
   * Tags follow the text. A grown summary is not the one the tags were written
   * against, and a name it no longer mentions must stop claiming the post:
   * being tagged is what puts a player's face on the card and the post on
   * their page, which says the story is about them.
   */
  if (enriched) await pruneStaleTags(rumorId);

  await db
    .update(feedItems)
    .set({ processedAt: new Date() })
    .where(eq(feedItems.id, item.id));
}

export type PublishResult =
  | { status: "published"; rumorId: number }
  | { status: "merged"; rumorId: number }
  | { status: "held"; rumorId: number }
  | { status: "rejected"; reason: string };

/** Turn one extraction into a rumor row plus its team and player tags. */
export async function publishExtraction(
  item: {
    id: number;
    sourceId: number;
    url: string;
    title: string;
    publisher: string | null;
    publishedAt: Date;
    sourceSlug: string;
  },
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

  // Same event, different outlet — attach rather than duplicate.
  const existing = await findExistingEvent(extraction.eventKey, item.publishedAt, {
    headline: extraction.headline,
    body: extraction.body,
    type: extraction.type,
    // Slugified here to match what the tags hold, without writing any rows yet.
    primaries: extraction.players.filter((p) => p.isPrimary).map((p) => slugify(p.name)),
  });
  if (existing) {
    await attachSource(existing.id, existing, item, extraction);
    return { status: "merged", rumorId: existing.id };
  }

  const isPublished = extraction.confidence >= PUBLISH_THRESHOLD;

  const [rumor] = await db
    .insert(rumors)
    .values({
      slug: `${slugify(extraction.headline)}-${item.id}`,
      eventKey: extraction.eventKey.trim().toLowerCase() || null,
      contractValue: extraction.contractValue?.slice(0, 24) ?? null,
      contractYears: extraction.contractYears ?? null,
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
      /*
       * Belt and braces while primaries are still singular.
       *
       * The feed used to infer a roundup from the primary count, and that
       * proxy held only because extraction names one subject per post. Asking
       * the model directly is the honest signal and the one that survives
       * plural primaries, but it is new and unproven, so for now a post that
       * somehow comes back with two subjects is still treated as a survey —
       * exactly the old behaviour.
       *
       * DELETE THE SECOND CLAUSE when primaries go plural. Left in place it
       * would flag every multi-player trade as a roundup and dock it 25
       * points, which is the regression this whole step exists to prevent.
       */
      isRoundup:
        extraction.isRoundup ||
        extraction.players.filter((p) => p.isPrimary).length > 1,
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

  // The originating report is a source too, so the byline list is complete.
  await db
    .insert(rumorSources)
    .values({
      rumorId: rumor.id,
      sourceId: item.sourceId,
      feedItemId: item.id,
      sourceUrl: item.url,
      publisher: item.publisher,
      reportedBy: extraction.reportedBy?.slice(0, 128) ?? null,
      headline: extraction.headline,
      publishedAt: item.publishedAt,
    })
    .onConflictDoNothing({ target: rumorSources.feedItemId });

  /*
   * Needed for both the team tags and each player's own direction, so it is
   * loaded once rather than per link.
   */
  const teamRows = await db
    .select({ id: teams.id, abbreviation: teams.abbreviation })
    .from(teams);
  const byAbbrev = new Map(teamRows.map((r) => [r.abbreviation, r.id]));

  // Team tags — ignore abbreviations the model invented.
  const abbrevs = [...new Set(extraction.teams.map((t) => t.abbreviation))];
  if (abbrevs.length > 0) {
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
      .values({
        rumorId: rumor.id,
        playerId,
        isPrimary: p.isPrimary,
        // Each player's own direction, so a multi-player deal can show who
        // goes where rather than one arrow for the whole post.
        fromTeamId: p.fromTeam ? (byAbbrev.get(p.fromTeam) ?? null) : null,
        toTeamId: p.toTeam ? (byAbbrev.get(p.toTeam) ?? null) : null,
      })
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
