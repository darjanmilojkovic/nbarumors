CREATE TABLE "player_slug_redirects" (
	"from_slug" varchar(128) PRIMARY KEY NOT NULL,
	"player_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "player_slug_redirects" ADD CONSTRAINT "player_slug_redirects_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_slug_redirects_player_idx" ON "player_slug_redirects" USING btree ("player_id");