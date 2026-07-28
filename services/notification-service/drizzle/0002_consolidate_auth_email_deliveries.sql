CREATE TABLE "auth_email_deliveries" (
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
	CONSTRAINT "auth_email_deliveries_status_valid" CHECK ("auth_email_deliveries"."status" IN ('pending', 'processing', 'retry_scheduled', 'delivered', 'failed', 'expired', 'rejected')),
	CONSTRAINT "auth_email_deliveries_attempt_count_valid" CHECK ("auth_email_deliveries"."attempt_count" >= 0 AND "auth_email_deliveries"."attempt_count" <= 3)
);
--> statement-breakpoint
INSERT INTO "auth_email_deliveries" (
	"job_id",
	"job_type",
	"status",
	"attempt_count",
	"provider_message_id",
	"failure_code",
	"expires_at",
	"processing_token",
	"lease_expires_at",
	"next_attempt_at",
	"delivered_at",
	"terminal_at",
	"created_at",
	"updated_at"
)
SELECT
	"job_id",
	"job_type",
	"status",
	"attempt_count",
	"provider_message_id",
	"failure_code",
	"expires_at",
	"processing_token",
	"lease_expires_at",
	"next_attempt_at",
	"delivered_at",
	"terminal_at",
	"created_at",
	"updated_at"
FROM "email_verification_deliveries";
--> statement-breakpoint
INSERT INTO "auth_email_deliveries" (
	"job_id",
	"job_type",
	"status",
	"attempt_count",
	"provider_message_id",
	"failure_code",
	"expires_at",
	"processing_token",
	"lease_expires_at",
	"next_attempt_at",
	"delivered_at",
	"terminal_at",
	"created_at",
	"updated_at"
)
SELECT
	"job_id",
	"job_type",
	"status",
	"attempt_count",
	"provider_message_id",
	"failure_code",
	"expires_at",
	"processing_token",
	"lease_expires_at",
	"next_attempt_at",
	"delivered_at",
	"terminal_at",
	"created_at",
	"updated_at"
FROM "password_reset_deliveries";
--> statement-breakpoint
DROP TABLE "email_verification_deliveries";--> statement-breakpoint
DROP TABLE "password_reset_deliveries";--> statement-breakpoint
CREATE INDEX "auth_email_deliveries_status_idx" ON "auth_email_deliveries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "auth_email_deliveries_next_attempt_idx" ON "auth_email_deliveries" USING btree ("next_attempt_at");
