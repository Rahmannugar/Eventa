ALTER TABLE "event_admin_audit_log" DROP CONSTRAINT "event_admin_audit_action_allowed";--> statement-breakpoint
DROP INDEX "event_ticket_types_currency_name_unique";--> statement-breakpoint
DROP INDEX "event_ticket_types_currency_created_index";--> statement-breakpoint
ALTER TABLE "event_ticket_types" ADD COLUMN "reserved_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_ticket_types" ADD COLUMN "sold_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_ticket_types" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "event_ticket_types" ADD COLUMN "retired_event_version" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "event_ticket_types_currency_name_unique" ON "event_ticket_types" USING btree ("ticket_currency_id",lower("name")) WHERE "event_ticket_types"."retired_at" IS NULL;--> statement-breakpoint
CREATE INDEX "event_ticket_types_currency_created_index" ON "event_ticket_types" USING btree ("ticket_currency_id","created_at","id") WHERE "event_ticket_types"."retired_at" IS NULL;--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" ADD CONSTRAINT "event_admin_audit_action_allowed" CHECK ("event_admin_audit_log"."action" IN ('event.created', 'event.updated', 'event.media_upload_requested', 'event.media_attached', 'event.media_replaced', 'event.media_removed', 'event.published', 'event.retired', 'event.ticket_currency_defined', 'event.ticket_type_created', 'event.ticket_type_updated', 'event.ticket_type_retired'));--> statement-breakpoint
ALTER TABLE "event_ticket_types" ADD CONSTRAINT "event_ticket_types_reserved_quantity_range" CHECK ("event_ticket_types"."reserved_quantity" BETWEEN 0 AND "event_ticket_types"."capacity");--> statement-breakpoint
ALTER TABLE "event_ticket_types" ADD CONSTRAINT "event_ticket_types_sold_quantity_range" CHECK ("event_ticket_types"."sold_quantity" BETWEEN 0 AND "event_ticket_types"."capacity");--> statement-breakpoint
ALTER TABLE "event_ticket_types" ADD CONSTRAINT "event_ticket_types_committed_capacity_valid" CHECK ("event_ticket_types"."reserved_quantity" + "event_ticket_types"."sold_quantity" <= "event_ticket_types"."capacity");--> statement-breakpoint
ALTER TABLE "event_ticket_types" ADD CONSTRAINT "event_ticket_types_retirement_shape" CHECK (("event_ticket_types"."retired_at" IS NULL AND "event_ticket_types"."retired_event_version" IS NULL) OR ("event_ticket_types"."retired_at" IS NOT NULL AND "event_ticket_types"."retired_event_version" >= 1));