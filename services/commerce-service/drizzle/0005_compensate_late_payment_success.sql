CREATE TABLE "payment_refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" varchar(3) NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"provider_idempotency_key" varchar(255) NOT NULL,
	"provider_refund_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_refunds_amount_positive" CHECK (amount_minor > 0),
	CONSTRAINT "payment_refunds_status_shape" CHECK (status IN ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_payment_id_payment_attempts_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refunds_payment_unique" ON "payment_refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refunds_order_unique" ON "payment_refunds" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refunds_provider_key_unique" ON "payment_refunds" USING btree ("provider_idempotency_key");