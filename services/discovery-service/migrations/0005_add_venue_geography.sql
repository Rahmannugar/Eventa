CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE discovery_event_index ADD COLUMN venue_latitude double precision;
ALTER TABLE discovery_event_index ADD COLUMN venue_longitude double precision;

ALTER TABLE discovery_event_index ADD COLUMN venue_geo geography(Point, 4326)
    GENERATED ALWAYS AS (
        CASE WHEN venue_latitude IS NOT NULL
            THEN ST_SetSRID(ST_MakePoint(venue_longitude, venue_latitude), 4326)::geography
        END
    ) STORED;

ALTER TABLE discovery_event_index ADD CONSTRAINT discovery_event_index_latitude_range
    CHECK (venue_latitude IS NULL OR (venue_latitude >= -90 AND venue_latitude <= 90));
ALTER TABLE discovery_event_index ADD CONSTRAINT discovery_event_index_longitude_range
    CHECK (venue_longitude IS NULL OR (venue_longitude >= -180 AND venue_longitude <= 180));
ALTER TABLE discovery_event_index ADD CONSTRAINT discovery_event_index_coordinates_paired
    CHECK ((venue_latitude IS NULL) = (venue_longitude IS NULL));

CREATE INDEX discovery_event_index_venue_geo_idx
    ON discovery_event_index USING gist (venue_geo);

CREATE TABLE discovery_venue_geo_refresh (
    event_id uuid PRIMARY KEY,
    attempt_count integer NOT NULL DEFAULT 0,
    next_attempt_at timestamp with time zone NOT NULL DEFAULT now(),
    claimed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);

---- create above / drop below ----
DROP TABLE discovery_venue_geo_refresh;
DROP INDEX discovery_event_index_venue_geo_idx;
ALTER TABLE discovery_event_index DROP CONSTRAINT discovery_event_index_coordinates_paired;
ALTER TABLE discovery_event_index DROP CONSTRAINT discovery_event_index_longitude_range;
ALTER TABLE discovery_event_index DROP CONSTRAINT discovery_event_index_latitude_range;
ALTER TABLE discovery_event_index DROP COLUMN venue_geo;
ALTER TABLE discovery_event_index DROP COLUMN venue_longitude;
ALTER TABLE discovery_event_index DROP COLUMN venue_latitude;
