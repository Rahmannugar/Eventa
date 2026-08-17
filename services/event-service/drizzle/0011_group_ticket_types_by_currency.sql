ALTER TABLE "event_ticket_types" RENAME COLUMN "allocation" TO "capacity";--> statement-breakpoint
ALTER TABLE "event_ticket_types" DROP CONSTRAINT "event_ticket_types_allocation_range";--> statement-breakpoint
ALTER TABLE "event_ticket_types" DROP CONSTRAINT "event_ticket_types_currency_fk";--> statement-breakpoint
DROP INDEX "event_ticket_types_event_name_unique";--> statement-breakpoint
DROP INDEX "event_ticket_types_event_created_index";--> statement-breakpoint
ALTER TABLE "event_ticket_currencies" DROP CONSTRAINT "event_ticket_configurations_pkey";--> statement-breakpoint
ALTER TABLE "event_ticket_currencies" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "event_ticket_types" ADD COLUMN "ticket_currency_id" uuid;--> statement-breakpoint
UPDATE "event_ticket_types" AS "ticket_type"
SET "ticket_currency_id" = "ticket_currency"."id"
FROM "event_ticket_currencies" AS "ticket_currency"
WHERE "ticket_currency"."event_id" = "ticket_type"."event_id";--> statement-breakpoint
ALTER TABLE "event_ticket_types" ALTER COLUMN "ticket_currency_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "event_ticket_currencies" ADD CONSTRAINT "event_ticket_currencies_pkey" PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "event_ticket_types" ADD CONSTRAINT "event_ticket_types_ticket_currency_id_event_ticket_currencies_id_fk" FOREIGN KEY ("ticket_currency_id") REFERENCES "public"."event_ticket_currencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_ticket_currencies_event_currency_unique" ON "event_ticket_currencies" USING btree ("event_id","currency");--> statement-breakpoint
CREATE INDEX "event_ticket_currencies_event_created_index" ON "event_ticket_currencies" USING btree ("event_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_ticket_types_currency_name_unique" ON "event_ticket_types" USING btree ("ticket_currency_id",lower("name"));--> statement-breakpoint
CREATE INDEX "event_ticket_types_currency_created_index" ON "event_ticket_types" USING btree ("ticket_currency_id","created_at","id");--> statement-breakpoint
ALTER TABLE "event_ticket_types" DROP COLUMN "event_id";--> statement-breakpoint
ALTER TABLE "event_ticket_types" ADD CONSTRAINT "event_ticket_types_capacity_range" CHECK ("event_ticket_types"."capacity" BETWEEN 1 AND 1000000);
