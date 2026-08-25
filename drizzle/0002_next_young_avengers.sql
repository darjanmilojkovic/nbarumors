ALTER TABLE "players" ADD COLUMN "prominence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "points_per_game" real;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "stats_synced_at" timestamp with time zone;