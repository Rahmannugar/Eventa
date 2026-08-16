ALTER TABLE "event_admin_audit_log" DROP CONSTRAINT "event_admin_audit_action_allowed";--> statement-breakpoint
DROP INDEX "events_status_created_at_index";--> statement-breakpoint
DROP INDEX "events_starts_at_id_index";--> statement-breakpoint
DROP INDEX "events_updated_at_id_index";--> statement-breakpoint
DROP INDEX "events_title_search_index";--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "events_status_created_at_index" ON "events" USING btree ("status","created_at") WHERE "events"."retired_at" IS NULL;--> statement-breakpoint
CREATE INDEX "events_starts_at_id_index" ON "events" USING btree ("starts_at","id") WHERE "events"."retired_at" IS NULL;--> statement-breakpoint
CREATE INDEX "events_updated_at_id_index" ON "events" USING btree ("updated_at","id") WHERE "events"."retired_at" IS NULL;--> statement-breakpoint
CREATE INDEX "events_title_search_index" ON "events" USING gin (lower("title") gin_trgm_ops) WHERE "events"."retired_at" IS NULL;--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" ADD CONSTRAINT "event_admin_audit_action_allowed" CHECK ("event_admin_audit_log"."action" IN ('event.created', 'event.updated', 'event.media_upload_requested', 'event.media_attached', 'event.media_replaced', 'event.media_removed', 'event.published', 'event.retired'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_retired_draft_only" CHECK ("events"."retired_at" IS NULL OR "events"."status" = 'draft');
