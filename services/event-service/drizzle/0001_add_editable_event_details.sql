CREATE TABLE "event_venues" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"address_line_1" text NOT NULL,
	"address_line_2" text,
	"city" text NOT NULL,
	"region" text,
	"postal_code" text,
	"country_code" text NOT NULL,
	CONSTRAINT "event_venues_name_normalized" CHECK ("event_venues"."name" = btrim("event_venues"."name")),
	CONSTRAINT "event_venues_name_length" CHECK (char_length("event_venues"."name") BETWEEN 1 AND 160),
	CONSTRAINT "event_venues_address_line_1_normalized" CHECK ("event_venues"."address_line_1" = btrim("event_venues"."address_line_1")),
	CONSTRAINT "event_venues_address_line_1_length" CHECK (char_length("event_venues"."address_line_1") BETWEEN 1 AND 200),
	CONSTRAINT "event_venues_address_line_2_length" CHECK ("event_venues"."address_line_2" IS NULL OR char_length("event_venues"."address_line_2") BETWEEN 1 AND 200),
	CONSTRAINT "event_venues_address_line_2_normalized" CHECK ("event_venues"."address_line_2" IS NULL OR "event_venues"."address_line_2" = btrim("event_venues"."address_line_2")),
	CONSTRAINT "event_venues_city_normalized" CHECK ("event_venues"."city" = btrim("event_venues"."city")),
	CONSTRAINT "event_venues_city_length" CHECK (char_length("event_venues"."city") BETWEEN 1 AND 120),
	CONSTRAINT "event_venues_region_length" CHECK ("event_venues"."region" IS NULL OR char_length("event_venues"."region") BETWEEN 1 AND 120),
	CONSTRAINT "event_venues_region_normalized" CHECK ("event_venues"."region" IS NULL OR "event_venues"."region" = btrim("event_venues"."region")),
	CONSTRAINT "event_venues_postal_code_length" CHECK ("event_venues"."postal_code" IS NULL OR char_length("event_venues"."postal_code") BETWEEN 1 AND 32),
	CONSTRAINT "event_venues_postal_code_normalized" CHECK ("event_venues"."postal_code" IS NULL OR "event_venues"."postal_code" = btrim("event_venues"."postal_code")),
	CONSTRAINT "event_venues_country_code" CHECK ("event_venues"."country_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" DROP CONSTRAINT "event_admin_audit_action_allowed";--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" ADD COLUMN "event_version" integer;--> statement-breakpoint
UPDATE "event_admin_audit_log" SET "event_version" = 1 WHERE "event_version" IS NULL;--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" ALTER COLUMN "event_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "event_venues" ADD CONSTRAINT "event_venues_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" ADD CONSTRAINT "event_admin_audit_version_positive" CHECK ("event_admin_audit_log"."event_version" >= 1);--> statement-breakpoint
ALTER TABLE "event_admin_audit_log" ADD CONSTRAINT "event_admin_audit_action_allowed" CHECK ("event_admin_audit_log"."action" IN ('event.created', 'event.updated'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_description_length" CHECK ("events"."description" IS NULL OR char_length("events"."description") BETWEEN 1 AND 10000);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_description_normalized" CHECK ("events"."description" IS NULL OR "events"."description" = btrim("events"."description"));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_category_normalized" CHECK ("events"."category" IS NULL OR "events"."category" = btrim("events"."category"));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_category_length" CHECK ("events"."category" IS NULL OR char_length("events"."category") BETWEEN 1 AND 80);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_schedule_valid" CHECK (("events"."starts_at" IS NULL AND "events"."ends_at" IS NULL AND "events"."time_zone" IS NULL) OR ("events"."starts_at" IS NOT NULL AND "events"."ends_at" IS NOT NULL AND "events"."time_zone" IS NOT NULL AND "events"."ends_at" > "events"."starts_at"));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_details_complete" CHECK (("events"."description" IS NULL AND "events"."category" IS NULL AND "events"."starts_at" IS NULL AND "events"."ends_at" IS NULL AND "events"."time_zone" IS NULL) OR ("events"."description" IS NOT NULL AND "events"."category" IS NOT NULL AND "events"."starts_at" IS NOT NULL AND "events"."ends_at" IS NOT NULL AND "events"."time_zone" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_time_zone_length" CHECK ("events"."time_zone" IS NULL OR char_length("events"."time_zone") BETWEEN 1 AND 64);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_version_positive" CHECK ("events"."version" >= 1);
