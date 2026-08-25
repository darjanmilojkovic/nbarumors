ALTER TABLE "rumors" ADD COLUMN "contract_value" varchar(24);--> statement-breakpoint
ALTER TABLE "rumors" ADD COLUMN "contract_years" integer;--> statement-breakpoint
ALTER TABLE "rumors" ADD COLUMN "outcome" varchar(16);--> statement-breakpoint
ALTER TABLE "rumors" ADD COLUMN "outcome_rumor_id" integer;--> statement-breakpoint
ALTER TABLE "rumors" ADD COLUMN "outcome_at" timestamp with time zone;