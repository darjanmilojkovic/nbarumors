import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  integer,
  boolean,
  real,
  primaryKey,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** What kind of newsworthy object a rumor is. Drives filtering and card labels. */
export const rumorTypeEnum = pgEnum("rumor_type", [
  "trade",
  "signing",
  "free_agency",
  "buyout",
  "extension",
  "waiver",
  "draft",
  "injury_impact",
  "other",
]);

/** Shape/purpose of a player image, so the UI can pick the right one per slot. */
export const imageKindEnum = pgEnum("image_kind", [
  "headshot", // NBA CDN mugshot, square-ish. Byline rows, tag pages.
  "action", // In-game photo, landscape. The card hero.
  "portrait", // Off-court or posed, portrait orientation.
  "composite", // Something we generated ourselves (e.g. two-player OG image).
]);

/**
 * Licensing terms we are allowed to publish under. Anything not on this list
 * does not get stored — no Getty/AP/team-photographer images, and no
 * media-brand graphics like the ClutchPoints composite.
 */
export const imageLicenseEnum = pgEnum("image_license", [
  "cc0",
  "cc_by",
  "cc_by_sa",
  "public_domain",
  "nba_cdn", // Official NBA headshot endpoint, hotlinked, not rehosted.
  "own", // We made it or we own the rights.
]);

/** How firm the report is: pure speculation vs. a done deal. */
export const rumorStatusEnum = pgEnum("rumor_status", [
  "rumor",
  "reported",
  "confirmed",
  "completed",
  "debunked",
]);

/** Categories. Seeded once with the 30 NBA franchises. */
export const teams = pgTable(
  "teams",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 64 }).notNull(),
    name: varchar("name", { length: 64 }).notNull(),
    city: varchar("city", { length: 64 }).notNull(),
    abbreviation: varchar("abbreviation", { length: 4 }).notNull(),
    conference: varchar("conference", { length: 8 }).notNull(),
    division: varchar("division", { length: 16 }).notNull(),
    /**
     * DEPRECATED — nothing reads this. Image paths are derived from the NBA
     * id against the manifest in lib/cached-images, which is generated from
     * the files in public/ and ships in the same deploy as them. Storing the
     * path here instead put the shared database and a deploy's files out of
     * step and blanked every image on the live site.
     */
    logoUrl: text("logo_url").notNull(),
    primaryColor: varchar("primary_color", { length: 7 }).notNull(),
    /** NBA's stable franchise id, used to build logo + headshot URLs. */
    nbaTeamId: varchar("nba_team_id", { length: 16 }).notNull(),
  },
  (t) => [
    uniqueIndex("teams_slug_idx").on(t.slug),
    uniqueIndex("teams_abbrev_idx").on(t.abbreviation),
  ],
);

/** Tags. Seeded from rosters, then grown as extraction meets new names. */
export const players = pgTable(
  "players",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 96 }).notNull(),
    fullName: varchar("full_name", { length: 96 }).notNull(),
    /** Misspellings and nicknames seen in the wild, for extraction matching. */
    aliases: text("aliases").array().notNull().default([]),
    position: varchar("position", { length: 8 }),
    currentTeamId: integer("current_team_id").references(() => teams.id),
    /**
     * When nba.com's own player index last stated this player's club.
     *
     * The official roster is the better source and the slower one: a signing
     * takes days to appear there, so on the day Jonathan Kuminga agreed terms
     * in Minnesota the index still had him in Atlanta. Our own completed posts
     * are faster and less reliable. This is what lets the two be ranked
     * instead of one blindly overwriting the other — a post only wins if it
     * was published after the roster last spoke.
     */
    rosterSyncedAt: timestamp("roster_synced_at", { withTimezone: true }),
    /**
     * 0-35 career standing, from the league's own awards record.
     *
     * Replaces all-time scoring rank as the career half of prominence. That
     * rank could only see points, so it blanked the players who move most
     * often in trades — a Defensive Player of the Year scored nothing from it,
     * and neither did a career playmaker.
     */
    accolades: integer("accolades").notNull().default(0),
    /**
     * The distinct honours the league records for this player.
     *
     * Stored rather than derived away, so changing how honours are weighted
     * costs a recompute instead of re-reading 1,163 players one request at a
     * time — which is both slow and enough traffic to get refused.
     */
    honors: text("honors").array().notNull().default([]),
    /**
     * A rating this player cannot fall below, earned by an honour.
     *
     * An MVP or an All-NBA First Team is a permanent fact about a career, and
     * a top-ten all-time scorer sorting below a rotation guard because he is
     * retired reads as a bug. A floor fixes that without flattening the top:
     * a one-time All-Star from 2011 lands at 85, and a current star whose
     * season form computes to 100 still outranks him.
     */
    prominenceFloor: integer("prominence_floor").notNull().default(0),
    /** When the awards record was last read for this player. */
    awardsSyncedAt: timestamp("awards_synced_at", { withTimezone: true }),
    /**
     * 0-100 editorial weight, from season scoring stats plus all-time standing.
     * Drives feed ranking so a LeBron rumor outranks a fringe roster move.
     */
    prominence: integer("prominence").notNull().default(0),
    /**
     * On an NBA roster this season. False for names that only ever appeared
     * in a rumor (retired players, international signings, front-office staff
     * the extraction mistook for a player).
     */
    isActive: boolean("is_active").notNull().default(false),
    /** Season points per game at last sync, kept for debugging the score. */
    pointsPerGame: real("points_per_game"),
    statsSyncedAt: timestamp("stats_synced_at", { withTimezone: true }),
    /**
     * NBA's player id. Deterministically builds the CDN headshot URL, so we
     * keep it here as a fast path; richer imagery lives in `player_images`.
     */
    nbaPlayerId: varchar("nba_player_id", { length: 16 }),
    /**
     * DEPRECATED — nothing reads this. Image paths are derived from the NBA
     * id against the manifest in lib/cached-images, which is generated from
     * the files in public/ and ships in the same deploy as them. Storing the
     * path here instead put the shared database and a deploy's files out of
     * step and blanked every image on the live site.
     */
    headshotUrl: text("headshot_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("players_slug_idx").on(t.slug),
    /*
     * One row per person. The slug cannot enforce that on its own — "Bobby
     * Portis" and "Bobby Portis Jr." are different slugs and the same player,
     * and we had five such pairs, each splitting a player's rumors and his
     * prominence across two pages. Partial, because most rows have no id:
     * anyone who only ever appeared in a rumor is unconstrained here.
     */
    uniqueIndex("players_nba_id_idx")
      .on(t.nbaPlayerId)
      .where(sql`${t.nbaPlayerId} is not null`),
    index("players_team_idx").on(t.currentTeamId),
  ],
);

/**
 * Player images, many per player. Every row carries the license and the
 * attribution string the license requires us to display — CC BY and CC BY-SA
 * both mandate credit, so a row without attribution is unusable and the
 * ingest refuses to write it.
 */
export const playerImages = pgTable(
  "player_images",
  {
    id: serial("id").primaryKey(),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    kind: imageKindEnum("kind").notNull().default("action"),
    /** Where we serve it from — remote URL, or our blob path once cached. */
    url: text("url").notNull(),
    /** Set once mirrored to Vercel Blob; null means we hotlink `url`. */
    blobPath: text("blob_path"),
    width: integer("width"),
    height: integer("height"),
    license: imageLicenseEnum("license").notNull(),
    /** Rendered credit line, e.g. "Erik Drost / CC BY 2.0". */
    attribution: text("attribution"),
    /** Canonical page for the image, needed for CC attribution links. */
    attributionUrl: text("attribution_url"),
    /** Page we found it on (Commons file page, NBA endpoint, etc.). */
    sourceUrl: text("source_url").notNull(),
    /** Preferred image for this player in this kind. */
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("player_images_player_idx").on(t.playerId, t.kind, t.isPrimary),
    uniqueIndex("player_images_url_idx").on(t.url),
  ],
);

/** Feed registry. One row per ingest source, with its polling cursor. */
export const sources = pgTable(
  "sources",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 64 }).notNull(),
    name: varchar("name", { length: 96 }).notNull(),
    homepageUrl: text("homepage_url").notNull(),
    feedUrl: text("feed_url").notNull(),
    kind: varchar("kind", { length: 16 }).notNull().default("rss"),
    enabled: boolean("enabled").notNull().default(true),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    lastItemAt: timestamp("last_item_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (t) => [uniqueIndex("sources_slug_idx").on(t.slug)],
);

/**
 * Raw feed items, exactly as fetched. Never rendered publicly — this is the
 * audit trail and the input to extraction. Copyrighted text stops here.
 */
export const feedItems = pgTable(
  "feed_items",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id),
    /** sha256 of the canonical URL — the dedupe key. */
    urlHash: varchar("url_hash", { length: 64 }).notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    rawSummary: text("raw_summary"),
    author: varchar("author", { length: 128 }),
    /**
     * Outlet that actually published the story. For direct feeds this is the
     * URL's domain; for Google News, whose links stay on a redirector, it is
     * parsed from the " - Publisher" suffix Google appends to every title.
     */
    publisher: varchar("publisher", { length: 96 }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** null = not yet processed, set once extraction has run. */
    processedAt: timestamp("processed_at", { withTimezone: true }),
    /** Extraction decided this item is not a transfer/rumor story. */
    rejectedReason: text("rejected_reason"),
  },
  (t) => [
    uniqueIndex("feed_items_url_hash_idx").on(t.urlHash),
    index("feed_items_unprocessed_idx").on(t.processedAt, t.publishedAt),
  ],
);

/**
 * The published object. `headline` and `body` are our own words, written from
 * the source; attribution + sourceUrl always accompany them.
 */
export const rumors = pgTable(
  "rumors",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 160 }).notNull(),
    headline: text("headline").notNull(),
    body: text("body").notNull(),
    type: rumorTypeEnum("type").notNull().default("other"),
    status: rumorStatusEnum("status").notNull().default("rumor"),
    /** Model's 0-1 confidence that this is a real, on-topic transfer story. */
    confidence: real("confidence").notNull().default(0.5),
    /** Reporter credited in the original, e.g. "Shams Charania". */
    reportedBy: varchar("reported_by", { length: 128 }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id),
    feedItemId: integer("feed_item_id")
      .notNull()
      .references(() => feedItems.id),
    /**
     * Canonical identifier for the underlying event, e.g.
     * "dillon-brooks-suns-extension-3yr-73m". Four outlets reporting the same
     * signing share a key and collapse into one post; four different angles on
     * the same player's free agency do not.
     */
    eventKey: varchar("event_key", { length: 160 }),
    /** Headline money, when the report states it. "$73M", "$3.3M". */
    contractValue: varchar("contract_value", { length: 24 }),
    contractYears: integer("contract_years"),
    /**
     * Outcome verification. A rumor is checked against the official
     * transaction log: `confirmed` when a matching transaction landed after
     * it, `unrecorded` when enough time passed with nothing on record.
     *
     * "unrecorded" deliberately does not say "never happened" — our log
     * covers one season and excludes waivers and two-ways, so absence of a
     * record is not proof of absence.
     */
    outcome: varchar("outcome", { length: 16 }),
    outcomeRumorId: integer("outcome_rumor_id"),
    outcomeAt: timestamp("outcome_at", { withTimezone: true }),
    sourceUrl: text("source_url").notNull(),
    /**
     * Card hero. Chosen at publish time from the primary player's images —
     * an `action` shot when we have one, else their headshot, else the card
     * falls back to the two team logos alone.
     */
    imageId: integer("image_id").references(() => playerImages.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    /*
     * When the summary was last rewritten to take in a later report.
     *
     * Distinct from published_at, which stays pinned to the first report and
     * is what the card's timestamp and the feed ordering read. A post that has
     * absorbed a follow-up is still the same story from the same moment; it
     * just says more than it did, and the reader deserves to be told which.
     */
    bodyUpdatedAt: timestamp("body_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Hold back low-confidence extractions for review instead of publishing. */
    isPublished: boolean("is_published").notNull().default(false),
  },
  (t) => [
    uniqueIndex("rumors_slug_idx").on(t.slug),
    uniqueIndex("rumors_feed_item_idx").on(t.feedItemId),
    index("rumors_feed_idx").on(t.isPublished, t.publishedAt),
    index("rumors_type_idx").on(t.type),
  ],
);

/**
 * Every outlet that reported a given rumor. The first one creates the rumor;
 * later ones attach here instead of creating a duplicate post, which is what
 * feeds the "also reported by" line and the corroboration count.
 */
export const rumorSources = pgTable(
  "rumor_sources",
  {
    id: serial("id").primaryKey(),
    rumorId: integer("rumor_id")
      .notNull()
      .references(() => rumors.id, { onDelete: "cascade" }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id),
    /** One row per feed item, so re-processing can never double-count. */
    feedItemId: integer("feed_item_id")
      .notNull()
      .references(() => feedItems.id),
    sourceUrl: text("source_url").notNull(),
    publisher: varchar("publisher", { length: 96 }),
    reportedBy: varchar("reported_by", { length: 128 }),
    headline: text("headline").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("rumor_sources_feed_item_idx").on(t.feedItemId),
    index("rumor_sources_rumor_idx").on(t.rumorId),
  ],
);

/** Team involvement, with direction — powers the two-logo card layout. */
export const rumorTeams = pgTable(
  "rumor_teams",
  {
    rumorId: integer("rumor_id")
      .notNull()
      .references(() => rumors.id, { onDelete: "cascade" }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id),
    /** "to" = acquiring, "from" = losing, "mentioned" = otherwise involved. */
    role: varchar("role", { length: 12 }).notNull().default("mentioned"),
  },
  (t) => [
    primaryKey({ columns: [t.rumorId, t.teamId] }),
    index("rumor_teams_team_idx").on(t.teamId),
  ],
);

/** Player tags. */
export const rumorPlayers = pgTable(
  "rumor_players",
  {
    rumorId: integer("rumor_id")
      .notNull()
      .references(() => rumors.id, { onDelete: "cascade" }),
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id),
    /** The player the rumor is actually about, vs. a name merely mentioned. */
    isPrimary: boolean("is_primary").notNull().default(false),
    /*
     * Where THIS player is going, when the post moves more than one.
     *
     * rumor_teams records that a post involves GSW, ATL and MIL, but not who
     * goes where — so a three-team proposal sending Butler to Atlanta and
     * Kuminga to Milwaukee could only ever render one arrow, pointing at
     * whichever destination the rows happened to come back in. Null on the
     * ordinary single-player post, where the post's own from/to already says
     * it.
     */
    fromTeamId: integer("from_team_id").references(() => teams.id),
    toTeamId: integer("to_team_id").references(() => teams.id),
  },
  (t) => [
    primaryKey({ columns: [t.rumorId, t.playerId] }),
    index("rumor_players_player_idx").on(t.playerId),
  ],
);

/**
 * Slugs that used to be a player page and now belong to someone else's row.
 *
 * Merging the five duplicate players deleted the losing rows, and with them
 * five URLs that had been live and indexed — /player/bobby-portis-jr and
 * /player/aj-green among them. A 404 throws away whatever standing those
 * pages had; a permanent redirect hands it to the row that survived.
 *
 * Written by the merge script rather than kept as a list in the code, so a
 * future merge cannot forget to add one.
 */
export const playerSlugRedirects = pgTable(
  "player_slug_redirects",
  {
    /** The retired slug, as it appeared in the URL. */
    fromSlug: varchar("from_slug", { length: 128 }).primaryKey(),
    /*
     * Cascade: if the surviving player is himself merged away later, this row
     * would point at nothing. The merge script repoints existing redirects
     * onto the new survivor before deleting, so the cascade is a backstop
     * against a stale chain rather than the normal path.
     */
    playerId: integer("player_id")
      .notNull()
      .references(() => players.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("player_slug_redirects_player_idx").on(t.playerId)],
);

/**
 * The league's own record of completed player movement.
 *
 * Confirmations used to be judged against Basketball-Reference's season page,
 * scraped, run through extraction to become posts, and then compared to our
 * rumors by player slug. Three weaknesses, all of which this fixes: it was
 * imported by hand and had been frozen since 20 August, so nothing reported
 * after that could ever be confirmed; matching went through names, which is
 * exactly where "Bobby Portis" and "Bobby Portis Jr." come apart; and every
 * row cost an extraction call to become a comparison record.
 *
 * The NBA publishes the same thing as JSON with PLAYER_ID and TEAM_ID on every
 * row, so a confirmation is now an id match. Nothing here is rendered; it is
 * evidence, not content.
 */
export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    /** Stable hash of the row, so a re-sync of the full feed cannot duplicate. */
    externalId: varchar("external_id", { length: 40 }).notNull(),
    /** Signing, Waive, Trade, AwardOnWaivers, ContractConverted. */
    kind: varchar("kind", { length: 24 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /*
     * The NBA's own ids, kept as the feed gives them rather than resolved to
     * our rows. A transaction can name a player we have never heard of, and
     * the join should find nothing rather than fail to import.
     */
    nbaPlayerId: varchar("nba_player_id", { length: 16 }),
    nbaTeamId: varchar("nba_team_id", { length: 16 }),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("transactions_external_idx").on(t.externalId),
    index("transactions_player_idx").on(t.nbaPlayerId, t.occurredAt),
  ],
);

export type Team = typeof teams.$inferSelect;
export type Player = typeof players.$inferSelect;
export type PlayerImage = typeof playerImages.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type FeedItem = typeof feedItems.$inferSelect;
export type Rumor = typeof rumors.$inferSelect;
export type PlayerSlugRedirect = typeof playerSlugRedirects.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
