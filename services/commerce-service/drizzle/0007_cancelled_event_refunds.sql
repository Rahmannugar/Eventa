CREATE TABLE "commerce_event_cancellation_inbox" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" varchar(120) NOT NULL,
	"status" varchar(16) DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "commerce_event_cancellation_inbox_event_type_shape" CHECK (event_type = 'event.cancelled.v1'),
	CONSTRAINT "commerce_event_cancellation_inbox_status_shape" CHECK (status IN ('received', 'processed', 'failed')),
	CONSTRAINT "commerce_event_cancellation_inbox_processed_shape" CHECK ((status = 'processed' AND processed_at IS NOT NULL) OR (status <> 'processed' AND processed_at IS NULL))
);
--> statement-breakpoint
ALTER TABLE "payment_workflow_outcomes" DROP CONSTRAINT "payment_workflow_outcomes_kind_shape";--> statement-breakpoint
CREATE INDEX "commerce_event_cancellation_inbox_event_index" ON "commerce_event_cancellation_inbox" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "commerce_orders_event_status_index" ON "commerce_orders" USING btree ("event_id","status");--> statement-breakpoint
ALTER TABLE "payment_workflow_outcomes" ADD CONSTRAINT "payment_workflow_outcomes_kind_shape" CHECK (kind IN ('payment_succeeded', 'payment_canceled', 'event_cancelled'));