CREATE TABLE "payment_workflow_outcomes" (
	"payment_id" uuid NOT NULL,
	"kind" varchar(32) NOT NULL,
	"order_id" uuid NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_until" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_workflow_outcomes_payment_id_kind_pk" PRIMARY KEY("payment_id","kind"),
	CONSTRAINT "payment_workflow_outcomes_kind_shape" CHECK (kind IN ('payment_succeeded', 'payment_canceled')),
	CONSTRAINT "payment_workflow_outcomes_failures_nonnegative" CHECK (failures >= 0)
);
--> statement-breakpoint
ALTER TABLE "payment_workflow_outcomes" ADD CONSTRAINT "payment_workflow_outcomes_payment_id_payment_attempts_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_workflow_outcomes_claim_index" ON "payment_workflow_outcomes" USING btree ("available_at","payment_id","kind") WHERE processed_at IS NULL;