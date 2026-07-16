ALTER TABLE "attendee_accounts" ADD COLUMN "username" text;--> statement-breakpoint
UPDATE "attendee_accounts"
SET "username" = "attendee_profiles"."username"
FROM "attendee_profiles"
WHERE "attendee_profiles"."attendee_id" = "attendee_accounts"."id";--> statement-breakpoint
ALTER TABLE "attendee_accounts" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "attendee_accounts_username_unique" ON "attendee_accounts" USING btree ("username");--> statement-breakpoint
ALTER TABLE "attendee_accounts" ADD CONSTRAINT "attendee_accounts_username_canonical" CHECK ("attendee_accounts"."username" ~ '^[a-z0-9_]{3,30}$');--> statement-breakpoint
DROP TABLE "attendee_profiles";
