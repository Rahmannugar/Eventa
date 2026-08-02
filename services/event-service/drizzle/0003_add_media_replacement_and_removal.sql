CREATE TABLE "event_media_object_deletions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"job_published_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_token" uuid,
	"claim_expires_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_media_object_deletions_reason_allowed" CHECK ("event_media_object_deletions"."reason" IN ('replaced', 'removed')),
	CONSTRAINT "event_media_object_deletions_status_allowed" CHECK ("event_media_object_deletions"."status" IN ('pending', 'deleted', 'failed')),
	CONSTRAINT "event_media_object_deletions_attempt_count_bounded" CHECK ("event_media_object_deletions"."attempt_count" BETWEEN 0 AND 10),
	CONSTRAINT "event_media_object_deletions_terminal_shape" CHECK (("event_media_object_deletions"."status" = 'pending' AND "event_media_object_deletions"."deleted_at" IS NULL AND "event_media_object_deletions"."failed_at" IS NULL) OR ("event_media_object_deletions"."status" = 'deleted' AND "event_media_object_deletions"."deleted_at" IS NOT NULL AND "event_media_object_deletions"."failed_at" IS NULL) OR ("event_media_object_deletions"."status" = 'failed' AND "event_media_object_deletions"."deleted_at" IS NULL AND "event_media_object_deletions"."failed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" DROP CONSTRAINT "event_admin_audit_action_allowed";--> statement-breakpoint
CREATE UNIQUE INDEX "event_media_object_deletions_object_key_unique" ON "event_media_object_deletions" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "event_media_object_deletions_dispatch_index" ON "event_media_object_deletions" USING btree ("status","next_attempt_at","job_published_at");--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" ADD CONSTRAINT "event_admin_audit_action_allowed" CHECK ("event_admin_audit_log"."action" IN ('event.created', 'event.updated', 'event.media_upload_requested', 'event.media_attached', 'event.media_replaced', 'event.media_removed'));