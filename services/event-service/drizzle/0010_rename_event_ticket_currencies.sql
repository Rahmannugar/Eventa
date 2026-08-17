ALTER TABLE "event_ticket_configurations" RENAME TO "event_ticket_currencies";--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" DROP CONSTRAINT "event_admin_audit_action_allowed";--> statement-breakpoint
ALTER TABLE "event_ticket_currencies" DROP CONSTRAINT "event_ticket_configurations_currency_format";--> statement-breakpoint
ALTER TABLE "event_ticket_currencies" DROP CONSTRAINT "event_ticket_configurations_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "event_ticket_types" DROP CONSTRAINT "event_ticket_types_configuration_fk";
--> statement-breakpoint
ALTER TABLE "event_ticket_currencies" ADD CONSTRAINT "event_ticket_currencies_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_ticket_types" ADD CONSTRAINT "event_ticket_types_currency_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_ticket_currencies"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" ADD CONSTRAINT "event_admin_audit_action_allowed" CHECK ("event_admin_audit_log"."action" IN ('event.created', 'event.updated', 'event.media_upload_requested', 'event.media_attached', 'event.media_replaced', 'event.media_removed', 'event.published', 'event.retired', 'event.ticket_currency_defined', 'event.ticket_type_created'));--> statement-breakpoint
ALTER TABLE "event_ticket_currencies" ADD CONSTRAINT "event_ticket_currencies_currency_format" CHECK ("event_ticket_currencies"."currency" ~ '^[A-Z]{3}$');
