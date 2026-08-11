ALTER TABLE "attendee_lifecycle_outbox" DROP CONSTRAINT "attendee_lifecycle_outbox_attempt_count_valid";--> statement-breakpoint
DROP INDEX "attendee_lifecycle_outbox_pending_idx";--> statement-breakpoint
ALTER TABLE "attendee_lifecycle_outbox" ADD COLUMN "aggregate_type" text;--> statement-breakpoint
UPDATE "attendee_lifecycle_outbox" SET "aggregate_type" = 'eventa.identity.attendee-lifecycle.v1';--> statement-breakpoint
ALTER TABLE "attendee_lifecycle_outbox" ALTER COLUMN "aggregate_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attendee_lifecycle_outbox" DROP COLUMN "published_at";--> statement-breakpoint
ALTER TABLE "attendee_lifecycle_outbox" DROP COLUMN "attempt_count";--> statement-breakpoint
ALTER TABLE "attendee_lifecycle_outbox" DROP COLUMN "next_attempt_at";--> statement-breakpoint
ALTER TABLE "attendee_lifecycle_outbox" DROP COLUMN "claim_token";--> statement-breakpoint
ALTER TABLE "attendee_lifecycle_outbox" DROP COLUMN "claim_expires_at";--> statement-breakpoint
ALTER TABLE "attendee_lifecycle_outbox" DROP COLUMN "last_error_code";--> statement-breakpoint
ALTER TABLE "attendee_lifecycle_outbox" ADD CONSTRAINT "attendee_lifecycle_outbox_aggregate_type_valid" CHECK ("attendee_lifecycle_outbox"."aggregate_type" = 'eventa.identity.attendee-lifecycle.v1');
