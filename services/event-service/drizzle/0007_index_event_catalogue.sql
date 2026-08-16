CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "event_venues" ADD COLUMN "region_code" text;--> statement-breakpoint
CREATE INDEX "event_venues_country_region_event_index" ON "event_venues" USING btree ("country_code","region_code","event_id");--> statement-breakpoint
CREATE INDEX "events_starts_at_id_index" ON "events" USING btree ("starts_at","id");--> statement-breakpoint
CREATE INDEX "events_updated_at_id_index" ON "events" USING btree ("updated_at","id");--> statement-breakpoint
CREATE INDEX "events_title_search_index" ON "events" USING gin (lower("title") gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "event_venues" ADD CONSTRAINT "event_venues_region_code" CHECK ("event_venues"."region_code" IS NULL OR ("event_venues"."region" IS NOT NULL AND "event_venues"."region_code" ~ '^[A-Z0-9][A-Z0-9-]{0,7}$'));
