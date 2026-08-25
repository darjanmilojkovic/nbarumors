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
    /** NBA CDN team logo, e.g. https://cdn.nba.com/logos/nba/1610612755/global/L/logo.svg */
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
    headshotUrl: text("headshot_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("players_slug_idx").on(t.slug),
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
  },
  (t) => [
    primaryKey({ columns: [t.rumorId, t.playerId] }),
    index("rumor_players_player_idx").on(t.playerId),
  ],
);

export type Team = typeof teams.$inferSelect;
export type Player = typeof players.$inferSelect;
export type PlayerImage = typeof playerImages.$inferSelect;
export type Source = typeof sources.$inferSelect;
export type FeedItem = typeof feedItems.$inferSelect;
export type Rumor = typeof rumors.$inferSelect;
