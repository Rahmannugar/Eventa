ALTER TABLE "ticket_revocation_inbox" DROP CONSTRAINT "ticket_revocation_inbox_event_type_shape";--> statement-breakpoint
ALTER TABLE "cancellation_email_deliveries" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "cancellation_email_deliveries" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cancellation_email_deliveries" ADD COLUMN "provider_message_id" text;--> statement-breakpoint
ALTER TABLE "cancellation_email_deliveries" ADD COLUMN "failure_code" text;--> statement-breakpoint
ALTER TABLE "cancellation_email_deliveries" ADD COLUMN "processing_token" uuid;--> statement-breakpoint
ALTER TABLE "cancellation_email_deliveries" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cancellation_email_deliveries" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cancellation_email_deliveries" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cancellation_email_deliveries" ADD COLUMN "terminal_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cancellation_email_deliveries" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "cancellation_email_deliveries_status_idx" ON "cancellation_email_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cancellation_email_deliveries_next_attempt_idx" ON "cancellation_email_deliveries" USING btree ("next_attempt_at");--> statement-breakpoint
ALTER TABLE "cancellation_email_deliveries" ADD CONSTRAINT "cancellation_email_deliveries_status_valid" CHECK ("cancellation_email_deliveries"."status" IN ('pending', 'processing', 'retry_scheduled', 'delivered', 'failed', 'rejected'));--> statement-breakpoint
ALTER TABLE "cancellation_email_deliveries" ADD CONSTRAINT "cancellation_email_deliveries_attempt_count_valid" CHECK ("cancellation_email_deliveries"."attempt_count" >= 0 AND "cancellation_email_deliveries"."attempt_count" <= 3);--> statement-breakpoint
ALTER TABLE "ticket_revocation_inbox" ADD CONSTRAINT "ticket_revocation_inbox_event_type_shape" CHECK ("ticket_revocation_inbox"."event_type" = 'ticket.revoked.v1');