ALTER TABLE "players" ADD COLUMN "accolades" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "awards_synced_at" timestamp with time zone;