CREATE TABLE "event_media_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"actor_admin_id" uuid NOT NULL,
	"request_id" text NOT NULL,
	"slot" text NOT NULL,
	"object_key" text NOT NULL,
	"expected_event_version" integer NOT NULL,
	"declared_content_type" text NOT NULL,
	"declared_size_bytes" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_code" text,
	"attached_event_version" integer,
	"expires_at" timestamp with time zone NOT NULL,
	"verification_deadline_at" timestamp with time zone NOT NULL,
	"job_published_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"object_deletion_attempt_count" integer DEFAULT 0 NOT NULL,
	"claim_token" uuid,
	"claim_expires_at" timestamp with time zone,
	"object_deleted_at" timestamp with time zone,
	"object_deletion_failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_media_uploads_slot_allowed" CHECK ("event_media_uploads"."slot" IN ('cover', 'gallery_1', 'gallery_2', 'gallery_3', 'gallery_4')),
	CONSTRAINT "event_media_uploads_status_allowed" CHECK ("event_media_uploads"."status" IN ('pending', 'attached', 'rejected', 'conflict', 'expired')),
	CONSTRAINT "event_media_uploads_content_type_allowed" CHECK ("event_media_uploads"."declared_content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "event_media_uploads_size_allowed" CHECK ("event_media_uploads"."declared_size_bytes" BETWEEN 1 AND 8388608),
	CONSTRAINT "event_media_uploads_expected_version_positive" CHECK ("event_media_uploads"."expected_event_version" >= 1),
	CONSTRAINT "event_media_uploads_verification_deadline_after_upload" CHECK ("event_media_uploads"."verification_deadline_at" > "event_media_uploads"."expires_at"),
	CONSTRAINT "event_media_uploads_attempt_count_nonnegative" CHECK ("event_media_uploads"."attempt_count" >= 0),
	CONSTRAINT "event_media_uploads_object_deletion_attempt_count_nonnegative" CHECK ("event_media_uploads"."object_deletion_attempt_count" >= 0),
	CONSTRAINT "event_media_uploads_request_id_length" CHECK (char_length("event_media_uploads"."request_id") BETWEEN 1 AND 128),
	CONSTRAINT "event_media_uploads_terminal_shape" CHECK (("event_media_uploads"."status" = 'attached' AND "event_media_uploads"."attached_event_version" IS NOT NULL AND "event_media_uploads"."failure_code" IS NULL) OR ("event_media_uploads"."status" = 'pending' AND "event_media_uploads"."attached_event_version" IS NULL AND "event_media_uploads"."failure_code" IS NULL) OR ("event_media_uploads"."status" IN ('rejected', 'conflict', 'expired') AND "event_media_uploads"."attached_event_version" IS NULL AND "event_media_uploads"."failure_code" IS NOT NULL)),
	CONSTRAINT "event_media_uploads_object_deletion_shape" CHECK (NOT ("event_media_uploads"."object_deleted_at" IS NOT NULL AND "event_media_uploads"."object_deletion_failed_at" IS NOT NULL) AND ("event_media_uploads"."status" IN ('rejected', 'conflict', 'expired') OR ("event_media_uploads"."object_deletion_attempt_count" = 0 AND "event_media_uploads"."object_deleted_at" IS NULL AND "event_media_uploads"."object_deletion_failed_at" IS NULL)))
);
--> statement-breakpoint
CREATE TABLE "event_media" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"slot" text NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"etag" text NOT NULL,
	"attached_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_media_slot_allowed" CHECK ("event_media"."slot" IN ('cover', 'gallery_1', 'gallery_2', 'gallery_3', 'gallery_4')),
	CONSTRAINT "event_media_content_type_allowed" CHECK ("event_media"."content_type" IN ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "event_media_size_allowed" CHECK ("event_media"."size_bytes" BETWEEN 1 AND 8388608),
	CONSTRAINT "event_media_width_positive" CHECK ("event_media"."width" >= 1),
	CONSTRAINT "event_media_height_positive" CHECK ("event_media"."height" >= 1)
);
--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" DROP CONSTRAINT "event_admin_audit_action_allowed";--> statement-breakpoint
ALTER TABLE "event_media_uploads" ADD CONSTRAINT "event_media_uploads_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_media" ADD CONSTRAINT "event_media_id_event_media_uploads_id_fk" FOREIGN KEY ("id") REFERENCES "public"."event_media_uploads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_media" ADD CONSTRAINT "event_media_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_media_uploads_object_key_unique" ON "event_media_uploads" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "event_media_uploads_active_slot_unique" ON "event_media_uploads" USING btree ("event_id","slot") WHERE "event_media_uploads"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "event_media_uploads_dispatch_index" ON "event_media_uploads" USING btree ("status","next_attempt_at","job_published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "event_media_event_slot_unique" ON "event_media" USING btree ("event_id","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "event_media_object_key_unique" ON "event_media" USING btree ("object_key");--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" ADD CONSTRAINT "event_admin_audit_action_allowed" CHECK ("event_admin_audit_log"."action" IN ('event.created', 'event.updated', 'event.media_upload_requested', 'event.media_attached'));