-- +migrate Up
CREATE TABLE ticket_issuance_inbox (
    event_id uuid PRIMARY KEY,
    event_type text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed'))
);

CREATE TABLE issued_tickets (
    id uuid PRIMARY KEY,
    order_id uuid NOT NULL,
    attendee_id uuid NOT NULL,
    event_id uuid NOT NULL,
    ticket_type_id uuid NOT NULL,
    unit_index integer NOT NULL CHECK (unit_index >= 0),
    qr_secret_hash bytea NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'revoked', 'checked_in')),
    issued_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (order_id, unit_index)
);

CREATE INDEX issued_tickets_attendee_issued_idx ON issued_tickets (attendee_id, issued_at DESC, id DESC);

-- +migrate Down
DROP TABLE issued_tickets;
DROP TABLE ticket_issuance_inbox;
