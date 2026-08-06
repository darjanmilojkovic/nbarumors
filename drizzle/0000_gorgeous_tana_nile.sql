CREATE TYPE "public"."rumor_status" AS ENUM('rumor', 'reported', 'confirmed', 'completed', 'debunked');--> statement-breakpoint
CREATE TYPE "public"."rumor_type" AS ENUM('trade', 'signing', 'free_agency', 'buyout', 'extension', 'waiver', 'draft', 'injury_impact', 'other');--> statement-breakpoint
CREATE TABLE "feed_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"url_hash" varchar(64) NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"raw_summary" text,
	"author" varchar(128),
	"published_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"rejected_reason" text
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(96) NOT NULL,
	"full_name" varchar(96) NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"position" varchar(8),
	"current_team_id" integer,
	"nba_player_id" varchar(16),
	"headshot_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rumor_players" (
	"rumor_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "rumor_players_rumor_id_player_id_pk" PRIMARY KEY("rumor_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "rumor_teams" (
	"rumor_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"role" varchar(12) DEFAULT 'mentioned' NOT NULL,
	CONSTRAINT "rumor_teams_rumor_id_team_id_pk" PRIMARY KEY("rumor_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "rumors" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(160) NOT NULL,
	"headline" text NOT NULL,
	"body" text NOT NULL,
	"type" "rumor_type" DEFAULT 'other' NOT NULL,
	"status" "rumor_status" DEFAULT 'rumor' NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"reported_by" varchar(128),
	"source_id" integer NOT NULL,
	"feed_item_id" integer NOT NULL,
	"source_url" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(96) NOT NULL,
	"homepage_url" text NOT NULL,
	"feed_url" text NOT NULL,
	"kind" varchar(16) DEFAULT 'rss' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"last_item_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"city" varchar(64) NOT NULL,
	"abbreviation" varchar(4) NOT NULL,
	"conference" varchar(8) NOT NULL,
	"division" varchar(16) NOT NULL,
	"logo_url" text NOT NULL,
	"primary_color" varchar(7) NOT NULL,
	"nba_team_id" varchar(16) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feed_items" ADD CONSTRAINT "feed_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_current_team_id_teams_id_fk" FOREIGN KEY ("current_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rumor_players" ADD CONSTRAINT "rumor_players_rumor_id_rumors_id_fk" FOREIGN KEY ("rumor_id") REFERENCES "public"."rumors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rumor_players" ADD CONSTRAINT "rumor_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rumor_teams" ADD CONSTRAINT "rumor_teams_rumor_id_rumors_id_fk" FOREIGN KEY ("rumor_id") REFERENCES "public"."rumors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rumor_teams" ADD CONSTRAINT "rumor_teams_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rumors" ADD CONSTRAINT "rumors_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rumors" ADD CONSTRAINT "rumors_feed_item_id_feed_items_id_fk" FOREIGN KEY ("feed_item_id") REFERENCES "public"."feed_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feed_items_url_hash_idx" ON "feed_items" USING btree ("url_hash");--> statement-breakpoint
CREATE INDEX "feed_items_unprocessed_idx" ON "feed_items" USING btree ("processed_at","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "players_slug_idx" ON "players" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "players_team_idx" ON "players" USING btree ("current_team_id");--> statement-breakpoint
CREATE INDEX "rumor_players_player_idx" ON "rumor_players" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "rumor_teams_team_idx" ON "rumor_teams" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rumors_slug_idx" ON "rumors" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "rumors_feed_item_idx" ON "rumors" USING btree ("feed_item_id");--> statement-breakpoint
CREATE INDEX "rumors_feed_idx" ON "rumors" USING btree ("is_published","published_at");--> statement-breakpoint
CREATE INDEX "rumors_type_idx" ON "rumors" USING btree ("type");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_slug_idx" ON "sources" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_slug_idx" ON "teams" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_abbrev_idx" ON "teams" USING btree ("abbreviation");