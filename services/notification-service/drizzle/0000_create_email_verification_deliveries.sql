CREATE TABLE "email_verification_deliveries" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"job_type" text NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"failure_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"processing_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"terminal_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_verification_deliveries_status_valid" CHECK ("email_verification_deliveries"."status" IN ('pending', 'processing', 'retry_scheduled', 'delivered', 'failed', 'expired', 'rejected')),
	CONSTRAINT "email_verification_deliveries_attempt_count_valid" CHECK ("email_verification_deliveries"."attempt_count" >= 0 AND "email_verification_deliveries"."attempt_count" <= 3)
);
--> statement-breakpoint
CREATE INDEX "email_verification_deliveries_status_idx" ON "email_verification_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "email_verification_deliveries_next_attempt_idx" ON "email_verification_deliveries" USING btree ("next_attempt_at");
