CREATE TABLE "event_publication_outbox" (
	"event_id" uuid PRIMARY KEY NOT NULL,
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
	CONSTRAINT "event_publication_outbox_event_type_valid" CHECK ("event_publication_outbox"."event_type" = 'event.published.v1'),
	CONSTRAINT "event_publication_outbox_attempt_count_valid" CHECK ("event_publication_outbox"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" DROP CONSTRAINT "event_admin_audit_action_allowed";--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_status_allowed";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "event_publication_outbox_pending_idx" ON "event_publication_outbox" USING btree ("published_at","next_attempt_at","occurred_at");--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" ADD CONSTRAINT "event_admin_audit_action_allowed" CHECK ("event_admin_audit_log"."action" IN ('event.created', 'event.updated', 'event.media_upload_requested', 'event.media_attached', 'event.media_replaced', 'event.media_removed', 'event.published'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_published_at_shape" CHECK (("events"."status" = 'published') = ("events"."published_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_status_allowed" CHECK ("events"."status" IN ('draft', 'published'));