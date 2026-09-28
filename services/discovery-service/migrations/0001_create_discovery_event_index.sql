CREATE TABLE discovery_event_inbox (
    event_type text NOT NULL,
    message_id uuid NOT NULL,
    event_id uuid NOT NULL,
    received_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT discovery_event_inbox_event_type_valid
        CHECK (event_type IN ('event.published.v1', 'event.cancelled.v1')),
    CONSTRAINT discovery_event_inbox_pkey PRIMARY KEY (event_type, message_id)
);

CREATE INDEX discovery_event_inbox_event_id_idx ON discovery_event_inbox (event_id);

CREATE TABLE discovery_event_index (
    event_id uuid PRIMARY KEY,
    status text NOT NULL,
    version integer,
    published_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    title text,
    description text,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    time_zone text,
    categories text[] NOT NULL DEFAULT '{}',
    venue_name text,
    venue_city text,
    venue_country_code text,
    indexed_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT discovery_event_index_status_valid
        CHECK (status IN ('published', 'cancelled'))
);

CREATE INDEX discovery_event_index_status_idx ON discovery_event_index (status);

---- create above / drop below ----
DROP TABLE discovery_event_index;
DROP TABLE discovery_event_inbox;
