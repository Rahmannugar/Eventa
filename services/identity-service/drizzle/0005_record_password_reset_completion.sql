ALTER TABLE "admin_accounts" ADD COLUMN "password_reset_id" uuid;--> statement-breakpoint
ALTER TABLE "attendee_accounts" ADD COLUMN "password_reset_id" uuid;
