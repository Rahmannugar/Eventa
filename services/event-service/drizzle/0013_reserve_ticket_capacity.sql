CREATE TABLE "event_capacity_reservations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ticket_type_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_capacity_reservations_quantity_range" CHECK ("event_capacity_reservations"."quantity" BETWEEN 1 AND 1000000),
	CONSTRAINT "event_capacity_reservations_status_allowed" CHECK ("event_capacity_reservations"."status" IN ('active', 'finalized', 'released', 'expired')),
	CONSTRAINT "event_capacity_reservations_expiry_after_creation" CHECK ("event_capacity_reservations"."expires_at" > "event_capacity_reservations"."created_at"),
	CONSTRAINT "event_capacity_reservations_terminal_shape" CHECK (("event_capacity_reservations"."status" = 'active' AND "event_capacity_reservations"."completed_at" IS NULL) OR ("event_capacity_reservations"."status" IN ('finalized', 'released', 'expired') AND "event_capacity_reservations"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "event_capacity_reservations" ADD CONSTRAINT "event_capacity_reservations_ticket_type_id_event_ticket_types_id_fk" FOREIGN KEY ("ticket_type_id") REFERENCES "public"."event_ticket_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_capacity_reservations_active_expiry_index" ON "event_capacity_reservations" USING btree ("expires_at","id") WHERE "event_capacity_reservations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "event_capacity_reservations_type_active_expiry_index" ON "event_capacity_reservations" USING btree ("ticket_type_id","expires_at","id") WHERE "event_capacity_reservations"."status" = 'active';
