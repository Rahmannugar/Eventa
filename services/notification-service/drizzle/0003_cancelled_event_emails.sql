CREATE TABLE "cancellation_email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"attendee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cancellation_email_deliveries_event_attendee_unique" UNIQUE("event_id","attendee_id")
);
--> statement-breakpoint
CREATE TABLE "notification_job_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"routing_key" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_job_outbox_aggregate_type_valid" CHECK ("notification_job_outbox"."aggregate_type" = 'eventa.notification.jobs'),
	CONSTRAINT "notification_job_outbox_route_valid" CHECK (routing_key = 'eventa.notification.event-cancellation-email.v1'),
	CONSTRAINT "notification_job_outbox_event_type_valid" CHECK (event_type = 'notification.event-cancellation-email.v1')
);
--> statement-breakpoint
CREATE TABLE "ticket_revocation_inbox" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" varchar(120) NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_revocation_inbox_event_type_shape" CHECK (event_type = 'ticket.revoked.v1')
);
