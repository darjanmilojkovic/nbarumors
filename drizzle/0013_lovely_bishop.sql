ALTER TABLE "players" ADD COLUMN "honors" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "prominence_floor" integer DEFAULT 0 NOT NULL;