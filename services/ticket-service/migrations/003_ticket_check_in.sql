ALTER TABLE issued_tickets
    ADD COLUMN checked_in_at timestamptz,
    ADD COLUMN checked_in_by uuid;

CREATE TABLE ticket_check_in_outbox (
    event_id uuid PRIMARY KEY,
    ticket_id uuid NOT NULL UNIQUE REFERENCES issued_tickets (id),
    event_type text NOT NULL CHECK (event_type = 'ticket.checked-in.v1'),
    occurred_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);

CREATE INDEX ticket_check_in_outbox_pending_idx
    ON ticket_check_in_outbox (occurred_at, event_id)
    WHERE published_at IS NULL;

---- create above / drop below ----
DROP TABLE ticket_check_in_outbox;
ALTER TABLE issued_tickets
    DROP COLUMN checked_in_at,
    DROP COLUMN checked_in_by;
