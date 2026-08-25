CREATE TABLE "rumor_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"rumor_id" integer NOT NULL,
	"source_id" integer NOT NULL,
	"feed_item_id" integer NOT NULL,
	"source_url" text NOT NULL,
	"publisher" varchar(96),
	"reported_by" varchar(128),
	"headline" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rumors" ADD COLUMN "event_key" varchar(160);--> statement-breakpoint
ALTER TABLE "rumor_sources" ADD CONSTRAINT "rumor_sources_rumor_id_rumors_id_fk" FOREIGN KEY ("rumor_id") REFERENCES "public"."rumors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rumor_sources" ADD CONSTRAINT "rumor_sources_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rumor_sources" ADD CONSTRAINT "rumor_sources_feed_item_id_feed_items_id_fk" FOREIGN KEY ("feed_item_id") REFERENCES "public"."feed_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rumor_sources_feed_item_idx" ON "rumor_sources" USING btree ("feed_item_id");--> statement-breakpoint
CREATE INDEX "rumor_sources_rumor_idx" ON "rumor_sources" USING btree ("rumor_id");