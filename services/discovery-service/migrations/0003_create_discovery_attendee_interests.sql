CREATE TABLE discovery_attendee_interests (
    attendee_id uuid PRIMARY KEY,
    interests text[] NOT NULL,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT discovery_attendee_interests_count_valid
        CHECK (cardinality(interests) <= 50)
);

---- create above / drop below ----
DROP TABLE discovery_attendee_interests;
