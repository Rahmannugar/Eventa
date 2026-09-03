ALTER TABLE "commerce_orders" ADD COLUMN "expiry_claimed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce_orders" ADD COLUMN "expiry_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "commerce_orders_expiry_index" ON "commerce_orders" USING btree ("reservation_expires_at","id") WHERE status = 'pending_payment';--> statement-breakpoint
ALTER TABLE "commerce_orders" ADD CONSTRAINT "commerce_orders_expiry_failures_nonnegative" CHECK (expiry_failures >= 0);