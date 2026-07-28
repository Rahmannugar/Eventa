CREATE TABLE "attendee_lifecycle_outbox" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"attendee_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_token" uuid,
	"claim_expires_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendee_lifecycle_outbox_event_type_valid" CHECK ("attendee_lifecycle_outbox"."event_type" = 'attendee.deleted.v1'),
	CONSTRAINT "attendee_lifecycle_outbox_attempt_count_valid" CHECK ("attendee_lifecycle_outbox"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "attendee_lifecycle_outbox_pending_idx" ON "attendee_lifecycle_outbox" USING btree ("published_at","next_attempt_at","occurred_at");