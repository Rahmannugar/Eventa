ALTER TABLE "events" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_status_allowed";--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_status_allowed" CHECK ("events"."status" IN ('draft', 'published', 'cancelled'));--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_published_at_shape";--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_published_at_shape" CHECK ((("events"."status" IN ('published', 'cancelled')) = ("events"."published_at" IS NOT NULL)) AND (("events"."status" = 'cancelled') = ("events"."cancelled_at" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" DROP CONSTRAINT "event_admin_audit_action_allowed";--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" ADD CONSTRAINT "event_admin_audit_action_allowed" CHECK ("event_admin_audit_log"."action" IN ('event.created', 'event.updated', 'event.media_upload_requested', 'event.media_attached', 'event.media_replaced', 'event.media_removed', 'event.published', 'event.cancelled', 'event.retired', 'event.ticket_currency_defined', 'event.ticket_type_created', 'event.ticket_type_updated', 'event.ticket_type_retired'));--> statement-breakpoint
ALTER TABLE "event_publication_outbox" DROP CONSTRAINT "event_publication_outbox_pkey";--> statement-breakpoint
ALTER TABLE "event_publication_outbox" ADD CONSTRAINT "event_publication_outbox_pkey" PRIMARY KEY ("event_id", "event_type");--> statement-breakpoint
ALTER TABLE "event_publication_outbox" DROP CONSTRAINT "event_publication_outbox_event_type_valid";--> statement-breakpoint
ALTER TABLE "event_publication_outbox" ADD CONSTRAINT "event_publication_outbox_event_type_valid" CHECK ("event_publication_outbox"."event_type" IN ('event.published.v1', 'event.cancelled.v1'));
