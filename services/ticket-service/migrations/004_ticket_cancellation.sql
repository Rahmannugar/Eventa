DROP INDEX ticket_check_in_outbox_pending_idx;
ALTER TABLE ticket_check_in_outbox
    DROP COLUMN published_at;

ALTER TABLE ticket_check_in_outbox
    ADD COLUMN aggregate_type text,
    ADD COLUMN aggregate_id uuid,
    ADD COLUMN payload jsonb;

UPDATE ticket_check_in_outbox o
SET aggregate_type = 'eventa.ticket.check-in.v1', aggregate_id = o.ticket_id,
    payload = jsonb_build_object('messageId', o.event_id, 'eventId', t.event_id,
        'ticketId', t.id, 'attendeeId', t.attendee_id, 'checkedInAt', t.checked_in_at,
        'type', 'ticket.checked-in.v1')
FROM issued_tickets t WHERE t.id = o.ticket_id;

ALTER TABLE ticket_check_in_outbox
    ALTER COLUMN aggregate_type SET NOT NULL,
    ALTER COLUMN aggregate_id SET NOT NULL,
    ALTER COLUMN payload SET NOT NULL;

CREATE INDEX issued_tickets_event_revocation_idx
    ON issued_tickets (event_id, id)
    WHERE status <> 'revoked';

CREATE TABLE ticket_cancelled_events (
    event_id uuid PRIMARY KEY,
    cancellation_message_id uuid NOT NULL,
    cancelled_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ticket_cancellation_inbox (
    message_id uuid PRIMARY KEY,
    event_id uuid NOT NULL,
    event_type text NOT NULL CHECK (event_type = 'event.cancelled.v1'),
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed'))
);

CREATE TABLE ticket_revocation_outbox (
    event_id uuid PRIMARY KEY,
    aggregate_type text NOT NULL CHECK (aggregate_type = 'eventa.ticket.revoked.v1'),
    aggregate_id uuid NOT NULL REFERENCES issued_tickets (id),
    event_type text NOT NULL CHECK (event_type = 'ticket.revoked.v1'),
    payload jsonb NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ticket_revocation_outbox_order_idx
    ON ticket_revocation_outbox (occurred_at, event_id);

---- create above / drop below ----
DROP INDEX issued_tickets_event_revocation_idx;
DROP TABLE ticket_revocation_outbox;
DROP TABLE ticket_cancellation_inbox;
DROP TABLE ticket_cancelled_events;
ALTER TABLE ticket_check_in_outbox
    DROP COLUMN payload, DROP COLUMN aggregate_id, DROP COLUMN aggregate_type;
ALTER TABLE ticket_check_in_outbox ADD COLUMN published_at timestamptz;
CREATE INDEX ticket_check_in_outbox_pending_idx
    ON ticket_check_in_outbox (occurred_at, event_id)
    WHERE published_at IS NULL;
