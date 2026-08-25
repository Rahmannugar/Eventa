CREATE TYPE "commerce_order_status" AS ENUM ('pending_reservation', 'pending_payment', 'paid', 'failed', 'expired', 'refunding', 'refunded');
CREATE TABLE "commerce_orders" (
  "id" uuid PRIMARY KEY NOT NULL,
  "attendee_id" uuid NOT NULL,
  "idempotency_key" uuid NOT NULL,
  "event_id" uuid NOT NULL,
  "ticket_type_id" uuid NOT NULL,
  "requested_quantity" integer NOT NULL,
  "status" "commerce_order_status" DEFAULT 'pending_reservation' NOT NULL,
  "currency" varchar(3),
  "total_minor" integer,
  "reservation_expires_at" timestamp with time zone,
  "failure_code" varchar(80),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "commerce_orders_attendee_idempotency_unique" ON "commerce_orders" ("attendee_id","idempotency_key");
CREATE INDEX "commerce_orders_attendee_created_index" ON "commerce_orders" ("attendee_id","created_at","id");
CREATE INDEX "commerce_orders_pending_reservation_index" ON "commerce_orders" ("updated_at","id") WHERE status = 'pending_reservation';
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_requested_quantity_range" CHECK (requested_quantity BETWEEN 1 AND 1000000);
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_quote_shape" CHECK ((status = 'pending_reservation' AND currency IS NULL AND total_minor IS NULL AND reservation_expires_at IS NULL) OR (status <> 'pending_reservation' AND currency ~ '^[A-Z]{3}$' AND total_minor >= 0 AND reservation_expires_at IS NOT NULL));
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_failure_shape" CHECK ((status = 'failed' AND failure_code IS NOT NULL) OR (status <> 'failed' AND failure_code IS NULL));
CREATE TABLE "commerce_order_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "ticket_name" varchar(80) NOT NULL,
  "quantity" integer NOT NULL,
  "unit_price_minor" integer NOT NULL,
  "line_total_minor" integer NOT NULL
);
CREATE UNIQUE INDEX "commerce_order_items_one_per_order" ON "commerce_order_items" ("order_id");
ALTER TABLE "commerce_order_items" ADD CONSTRAINT "commerce_order_items_quantity_range" CHECK (quantity BETWEEN 1 AND 1000000);
ALTER TABLE "commerce_order_items" ADD CONSTRAINT "commerce_order_items_money_shape" CHECK (unit_price_minor >= 0 AND line_total_minor >= 0 AND line_total_minor = unit_price_minor * quantity);
ALTER TABLE "commerce_order_items" ADD CONSTRAINT "commerce_order_items_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "commerce_orders"("id") ON DELETE cascade;
