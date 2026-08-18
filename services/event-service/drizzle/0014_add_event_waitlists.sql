CREATE TABLE "event_waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"attendee_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"eligible_at" timestamp with time zone,
	"opportunity_expires_at" timestamp with time zone,
	"reservation_id" uuid,
	"left_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_waitlist_entries_quantity_range" CHECK ("event_waitlist_entries"."quantity" BETWEEN 1 AND 1000000),
	CONSTRAINT "event_waitlist_entries_status_allowed" CHECK ("event_waitlist_entries"."status" IN ('waiting', 'eligible', 'left', 'closed', 'expired', 'reserved')),
	CONSTRAINT "event_waitlist_entries_lifecycle_shape" CHECK (("event_waitlist_entries"."status" = 'waiting' AND "event_waitlist_entries"."eligible_at" IS NULL AND "event_waitlist_entries"."opportunity_expires_at" IS NULL AND "event_waitlist_entries"."reservation_id" IS NULL AND "event_waitlist_entries"."left_at" IS NULL AND "event_waitlist_entries"."closed_at" IS NULL) OR ("event_waitlist_entries"."status" = 'eligible' AND "event_waitlist_entries"."eligible_at" IS NOT NULL AND "event_waitlist_entries"."opportunity_expires_at" > "event_waitlist_entries"."eligible_at" AND "event_waitlist_entries"."reservation_id" IS NULL AND "event_waitlist_entries"."left_at" IS NULL AND "event_waitlist_entries"."closed_at" IS NULL) OR ("event_waitlist_entries"."status" = 'reserved' AND "event_waitlist_entries"."eligible_at" IS NOT NULL AND "event_waitlist_entries"."opportunity_expires_at" IS NOT NULL AND "event_waitlist_entries"."reservation_id" IS NOT NULL AND "event_waitlist_entries"."left_at" IS NULL AND "event_waitlist_entries"."closed_at" IS NULL) OR ("event_waitlist_entries"."status" = 'expired' AND "event_waitlist_entries"."eligible_at" IS NOT NULL AND "event_waitlist_entries"."opportunity_expires_at" IS NOT NULL AND "event_waitlist_entries"."reservation_id" IS NULL AND "event_waitlist_entries"."left_at" IS NULL AND "event_waitlist_entries"."closed_at" IS NOT NULL) OR ("event_waitlist_entries"."status" = 'left' AND "event_waitlist_entries"."reservation_id" IS NULL AND "event_waitlist_entries"."left_at" IS NOT NULL AND "event_waitlist_entries"."closed_at" IS NULL) OR ("event_waitlist_entries"."status" = 'closed' AND "event_waitlist_entries"."reservation_id" IS NULL AND "event_waitlist_entries"."left_at" IS NULL AND "event_waitlist_entries"."closed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "event_waitlist_outbox" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"aggregate_type" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_waitlist_outbox_aggregate_type_valid" CHECK ("event_waitlist_outbox"."aggregate_type" = 'eventa.event.waitlist.v1'),
	CONSTRAINT "event_waitlist_outbox_event_type_valid" CHECK ("event_waitlist_outbox"."event_type" = 'event.waitlist-entry.eligible.v1')
);
--> statement-breakpoint
ALTER TABLE "event_capacity_reservations" ADD COLUMN "attendee_id" uuid;--> statement-breakpoint
ALTER TABLE "event_waitlist_entries" ADD CONSTRAINT "event_waitlist_entries_ticket_type_id_event_ticket_types_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."event_ticket_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_waitlist_entries" ADD CONSTRAINT "event_waitlist_entries_reservation_id_event_capacity_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."event_capacity_reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_waitlist_entries_active_attendee_unique" ON "event_waitlist_entries" USING btree ("ticket_type_id","attendee_id") WHERE "event_waitlist_entries"."status" IN ('waiting', 'eligible');--> statement-breakpoint
CREATE INDEX "event_waitlist_entries_waiting_order_index" ON "event_waitlist_entries" USING btree ("ticket_type_id","created_at","id") WHERE "event_waitlist_entries"."status" = 'waiting';--> statement-breakpoint
CREATE INDEX "event_waitlist_entries_eligible_expiry_index" ON "event_waitlist_entries" USING btree ("ticket_type_id","opportunity_expires_at","id") WHERE "event_waitlist_entries"."status" = 'eligible';--> statement-breakpoint
CREATE INDEX "event_capacity_reservations_type_attendee_active_index" ON "event_capacity_reservations" USING btree ("ticket_type_id","attendee_id") WHERE "event_capacity_reservations"."status" = 'active';