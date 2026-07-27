ALTER TABLE "attendee_accounts" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendee_accounts" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendee_accounts" ADD CONSTRAINT "attendee_accounts_status_allowed" CHECK ("attendee_accounts"."status" IN ('active', 'suspended'));
