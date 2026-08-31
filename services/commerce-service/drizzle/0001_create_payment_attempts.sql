CREATE TYPE "public"."payment_attempt_status" AS ENUM('provider_pending', 'awaiting_confirmation');--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"attendee_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" "payment_attempt_status" DEFAULT 'provider_pending' NOT NULL,
	"provider" varchar(20) DEFAULT 'stripe' NOT NULL,
	"provider_idempotency_key" varchar(255) NOT NULL,
	"provider_payment_intent_id" varchar(255),
	"provider_status" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempts_amount_positive" CHECK (amount_minor > 0),
	CONSTRAINT "payment_attempts_currency_shape" CHECK (currency ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_attempts_provider_shape" CHECK (provider = 'stripe'),
	CONSTRAINT "payment_attempts_resolution_shape" CHECK ((status = 'provider_pending' AND provider_payment_intent_id IS NULL AND provider_status IS NULL) OR (status = 'awaiting_confirmation' AND provider_payment_intent_id IS NOT NULL AND provider_status IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_commerce_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_order_unique" ON "payment_attempts" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_provider_idempotency_unique" ON "payment_attempts" USING btree ("provider_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_attempts_provider_intent_unique" ON "payment_attempts" USING btree ("provider_payment_intent_id") WHERE provider_payment_intent_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payment_attempts_attendee_created_index" ON "payment_attempts" USING btree ("attendee_id","created_at","id");
