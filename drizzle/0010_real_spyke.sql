CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"external_id" varchar(40) NOT NULL,
	"kind" varchar(24) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"nba_player_id" varchar(16),
	"nba_team_id" varchar(16),
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_external_idx" ON "transactions" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "transactions_player_idx" ON "transactions" USING btree ("nba_player_id","occurred_at");