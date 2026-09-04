CREATE TABLE "commerce_order_outbox" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"aggregate_type" varchar(120) NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event_type" varchar(120) NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
