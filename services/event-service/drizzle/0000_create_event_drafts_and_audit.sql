CREATE TABLE "event_admin_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"actor_admin_id" uuid NOT NULL,
	"action" text NOT NULL,
	"request_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_admin_audit_action_allowed" CHECK ("event_admin_audit_log"."action" IN ('event.created')),
	CONSTRAINT "event_admin_audit_request_id_length" CHECK (char_length("event_admin_audit_log"."request_id") BETWEEN 1 AND 128)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_title_normalized" CHECK ("events"."title" = btrim("events"."title")),
	CONSTRAINT "events_title_length" CHECK (char_length("events"."title") BETWEEN 1 AND 160),
	CONSTRAINT "events_status_allowed" CHECK ("events"."status" IN ('draft'))
);
--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" ADD CONSTRAINT "event_admin_audit_log_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_admin_audit_event_time_index" ON "event_admin_audit_log" USING btree ("event_id","occurred_at");--> statement-breakpoint
CREATE INDEX "events_status_created_at_index" ON "events" USING btree ("status","created_at");
