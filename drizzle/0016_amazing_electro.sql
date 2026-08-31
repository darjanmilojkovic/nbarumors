CREATE TABLE "cron_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"ok" boolean,
	"duration_ms" integer,
	"detail" text
);
--> statement-breakpoint
CREATE INDEX "cron_runs_name_idx" ON "cron_runs" USING btree ("name","started_at");