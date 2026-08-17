CREATE TABLE "event_ticket_configurations" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"currency" varchar(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_ticket_configurations_currency_format" CHECK ("event_ticket_configurations"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "event_ticket_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_minor" integer NOT NULL,
	"allocation" integer NOT NULL,
	"sales_start_at" timestamp with time zone NOT NULL,
	"sales_end_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_ticket_types_name_normalized" CHECK ("event_ticket_types"."name" = btrim("event_ticket_types"."name") AND "event_ticket_types"."name" !~ '\s{2,}'),
	CONSTRAINT "event_ticket_types_name_length" CHECK (char_length("event_ticket_types"."name") BETWEEN 1 AND 80),
	CONSTRAINT "event_ticket_types_description_shape" CHECK ("event_ticket_types"."description" IS NULL OR ("event_ticket_types"."description" = btrim("event_ticket_types"."description") AND char_length("event_ticket_types"."description") BETWEEN 1 AND 500)),
	CONSTRAINT "event_ticket_types_price_range" CHECK ("event_ticket_types"."price_minor" BETWEEN 0 AND 2147483647),
	CONSTRAINT "event_ticket_types_allocation_range" CHECK ("event_ticket_types"."allocation" BETWEEN 1 AND 1000000),
	CONSTRAINT "event_ticket_types_sales_window_valid" CHECK ("event_ticket_types"."sales_end_at" > "event_ticket_types"."sales_start_at")
);
--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" DROP CONSTRAINT "event_admin_audit_action_allowed";--> statement-breakpoint
ALTER TABLE "event_ticket_configurations" ADD CONSTRAINT "event_ticket_configurations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_ticket_types" ADD CONSTRAINT "event_ticket_types_configuration_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event_ticket_configurations"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_ticket_types_event_name_unique" ON "event_ticket_types" USING btree ("event_id",lower("name"));--> statement-breakpoint
CREATE INDEX "event_ticket_types_event_created_index" ON "event_ticket_types" USING btree ("event_id","created_at","id");--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" ADD CONSTRAINT "event_admin_audit_action_allowed" CHECK ("event_admin_audit_log"."action" IN ('event.created', 'event.updated', 'event.media_upload_requested', 'event.media_attached', 'event.media_replaced', 'event.media_removed', 'event.published', 'event.retired', 'event.ticket_type_created'));
