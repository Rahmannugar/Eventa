CREATE TABLE "event_categories" (
	"event_id" uuid NOT NULL,
	"category" text NOT NULL,
	CONSTRAINT "event_categories_event_id_category_pk" PRIMARY KEY("event_id","category"),
	CONSTRAINT "event_categories_normalized" CHECK ("event_categories"."category" = btrim("event_categories"."category")),
	CONSTRAINT "event_categories_length" CHECK (char_length("event_categories"."category") BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_category_normalized";--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_category_length";--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_details_complete";--> statement-breakpoint
ALTER TABLE "event_categories" ADD CONSTRAINT "event_categories_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "event_categories" ("event_id", "category")
SELECT "id", "category"
FROM "events"
WHERE "category" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "event_categories_event_lower_category_unique" ON "event_categories" USING btree ("event_id",lower("category"));--> statement-breakpoint
CREATE INDEX "event_categories_category_index" ON "event_categories" USING btree ("category");--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_details_complete" CHECK (("events"."description" IS NULL AND "events"."starts_at" IS NULL AND "events"."ends_at" IS NULL AND "events"."time_zone" IS NULL) OR ("events"."description" IS NOT NULL AND "events"."starts_at" IS NOT NULL AND "events"."ends_at" IS NOT NULL AND "events"."time_zone" IS NOT NULL));
