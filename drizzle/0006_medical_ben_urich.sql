ALTER TABLE "rumor_players" ADD COLUMN "from_team_id" integer;--> statement-breakpoint
ALTER TABLE "rumor_players" ADD COLUMN "to_team_id" integer;--> statement-breakpoint
ALTER TABLE "rumor_players" ADD CONSTRAINT "rumor_players_from_team_id_teams_id_fk" FOREIGN KEY ("from_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rumor_players" ADD CONSTRAINT "rumor_players_to_team_id_teams_id_fk" FOREIGN KEY ("to_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;