CREATE TYPE "public"."provider_event_status" AS ENUM('received', 'processed', 'ignored');--> statement-breakpoint
CREATE TABLE "payment_provider_events" (
	"provider" varchar(20) DEFAULT 'stripe' NOT NULL,
	"provider_event_id" varchar(255) NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"provider_object_id" varchar(255) NOT NULL,
	"payment_id" uuid,
	"status" "provider_event_status" DEFAULT 'received' NOT NULL,
	"provider_created_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "payment_provider_events_primary" PRIMARY KEY("provider","provider_event_id"),
	CONSTRAINT "payment_provider_events_provider_shape" CHECK (provider = 'stripe'),
	CONSTRAINT "payment_provider_events_status_shape" CHECK ((status = 'received' AND processed_at IS NULL) OR (status IN ('processed', 'ignored') AND processed_at IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_resolution_shape";--> statement-breakpoint
ALTER TABLE "payment_attempts" ALTER COLUMN "status" SET DATA TYPE varchar(32) USING "status"::text;--> statement-breakpoint
ALTER TABLE "payment_attempts" ALTER COLUMN "status" SET DEFAULT 'provider_pending';--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "last_provider_event_id" varchar(255);--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "last_provider_event_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "reconcile_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "reconciliation_claimed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "reconciliation_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "last_reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_provider_events" ADD CONSTRAINT "payment_provider_events_payment_id_payment_attempts_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
UPDATE "payment_attempts"
SET "reconcile_after" = now()
WHERE "status" NOT IN ('succeeded', 'canceled');--> statement-breakpoint
CREATE INDEX "payment_provider_events_payment_index" ON "payment_provider_events" USING btree ("payment_id","provider_created_at");--> statement-breakpoint
CREATE INDEX "payment_attempts_reconciliation_index" ON "payment_attempts" USING btree ("reconcile_after","id") WHERE status NOT IN ('succeeded', 'canceled');--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_status_shape" CHECK (status IN ('provider_pending', 'awaiting_confirmation', 'requires_action', 'processing', 'failed', 'succeeded', 'canceled'));--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_reconciliation_failures_nonnegative" CHECK (reconciliation_failures >= 0);--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_resolution_shape" CHECK ((status = 'provider_pending' AND provider_payment_intent_id IS NULL AND provider_status IS NULL AND reconcile_after IS NOT NULL) OR (status IN ('succeeded', 'canceled') AND provider_payment_intent_id IS NOT NULL AND provider_status IS NOT NULL AND reconcile_after IS NULL) OR (status NOT IN ('provider_pending', 'succeeded', 'canceled') AND provider_payment_intent_id IS NOT NULL AND provider_status IS NOT NULL AND reconcile_after IS NOT NULL));--> statement-breakpoint
DROP TYPE "public"."payment_attempt_status";
