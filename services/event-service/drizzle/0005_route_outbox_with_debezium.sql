CREATE TABLE "event_job_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"routing_key" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_job_outbox_aggregate_type_valid" CHECK ("event_job_outbox"."aggregate_type" = 'eventa.event.jobs'),
	CONSTRAINT "event_job_outbox_route_valid" CHECK (("event_job_outbox"."event_type" = 'event.media-verification.v1' AND "event_job_outbox"."routing_key" = 'eventa.event.media-verification.v1') OR ("event_job_outbox"."event_type" = 'event.media-object-deletion.v1' AND "event_job_outbox"."routing_key" = 'eventa.event.media-object-deletion.v1'))
);
--> statement-breakpoint
ALTER TABLE "event_publication_outbox" DROP CONSTRAINT "event_publication_outbox_attempt_count_valid";--> statement-breakpoint
DROP INDEX "event_publication_outbox_pending_idx";--> statement-breakpoint
ALTER TABLE "event_publication_outbox" ADD COLUMN "aggregate_type" text;--> statement-breakpoint
UPDATE "event_publication_outbox" SET "aggregate_type" = 'eventa.event.lifecycle.v1';--> statement-breakpoint
ALTER TABLE "event_publication_outbox" ALTER COLUMN "aggregate_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "event_publication_outbox" DROP COLUMN "published_at";--> statement-breakpoint
ALTER TABLE "event_publication_outbox" DROP COLUMN "attempt_count";--> statement-breakpoint
ALTER TABLE "event_publication_outbox" DROP COLUMN "next_attempt_at";--> statement-breakpoint
ALTER TABLE "event_publication_outbox" DROP COLUMN "claim_token";--> statement-breakpoint
ALTER TABLE "event_publication_outbox" DROP COLUMN "claim_expires_at";--> statement-breakpoint
ALTER TABLE "event_publication_outbox" DROP COLUMN "last_error_code";--> statement-breakpoint
ALTER TABLE "event_publication_outbox" ADD CONSTRAINT "event_publication_outbox_aggregate_type_valid" CHECK ("event_publication_outbox"."aggregate_type" = 'eventa.event.lifecycle.v1');
