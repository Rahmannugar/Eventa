CREATE TABLE discovery_behaviour_inbox (
    event_type text NOT NULL,
    message_id uuid NOT NULL,
    attendee_id uuid NOT NULL,
    event_id uuid NOT NULL,
    received_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT discovery_behaviour_inbox_event_type_valid
        CHECK (event_type IN ('commerce.order-paid.v1', 'ticket.checked-in.v1')),
    CONSTRAINT discovery_behaviour_inbox_pkey PRIMARY KEY (event_type, message_id)
);

CREATE INDEX discovery_behaviour_inbox_attendee_id_idx
    ON discovery_behaviour_inbox (attendee_id);

CREATE TABLE discovery_attendee_behaviour (
    attendee_id uuid NOT NULL,
    event_id uuid NOT NULL,
    kind text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT discovery_attendee_behaviour_kind_valid
        CHECK (kind IN ('purchased', 'attended')),
    CONSTRAINT discovery_attendee_behaviour_pkey
        PRIMARY KEY (attendee_id, event_id, kind)
);

CREATE INDEX discovery_attendee_behaviour_attendee_id_idx
    ON discovery_attendee_behaviour (attendee_id, kind, occurred_at DESC);

---- create above / drop below ----
DROP TABLE discovery_attendee_behaviour;
DROP TABLE discovery_behaviour_inbox;
