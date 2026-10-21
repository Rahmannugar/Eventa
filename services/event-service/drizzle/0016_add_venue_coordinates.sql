CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
ALTER TABLE "event_venues" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "event_venues" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "event_venues" ADD CONSTRAINT "event_venues_latitude_range" CHECK ("event_venues"."latitude" IS NULL OR ("event_venues"."latitude" >= -90 AND "event_venues"."latitude" <= 90));--> statement-breakpoint
ALTER TABLE "event_venues" ADD CONSTRAINT "event_venues_longitude_range" CHECK ("event_venues"."longitude" IS NULL OR ("event_venues"."longitude" >= -180 AND "event_venues"."longitude" <= 180));--> statement-breakpoint
ALTER TABLE "event_venues" ADD CONSTRAINT "event_venues_coordinates_paired" CHECK ((("event_venues"."latitude" IS NULL) = ("event_venues"."longitude" IS NULL)));
