-- name: ClaimIssuanceEvent :one
INSERT INTO ticket_issuance_inbox (event_id, event_type)
VALUES ($1, 'commerce.order-paid.v1')
ON CONFLICT (event_id) DO NOTHING
RETURNING event_id;

-- name: LockEvent :exec
SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0));

-- name: IsEventCancelled :one
SELECT EXISTS (SELECT 1 FROM ticket_cancelled_events WHERE event_id = $1) AS cancelled;

-- name: CreateIssuedTicket :exec
INSERT INTO issued_tickets (id, order_id, attendee_id, event_id, ticket_type_id, unit_index, qr_token, qr_secret_hash)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8);

-- name: MarkIssuanceProcessed :exec
UPDATE ticket_issuance_inbox
SET status = 'processed', processed_at = now()
WHERE event_id = $1;

-- name: ListIssuedTicketsByAttendee :many
SELECT id, order_id, attendee_id, event_id, ticket_type_id, unit_index, status, issued_at, qr_token
FROM issued_tickets
WHERE attendee_id = $1
  AND ($2::timestamptz IS NULL OR (issued_at, id) < ($2::timestamptz, $3::uuid))
ORDER BY issued_at DESC, id DESC
LIMIT $4;

-- name: FindTicketForCheckIn :one
SELECT id, order_id, attendee_id, event_id, ticket_type_id, unit_index, status,
       issued_at, qr_token, checked_in_at, checked_in_by
FROM issued_tickets
WHERE qr_secret_hash = $1
FOR UPDATE;

-- name: MarkTicketCheckedIn :exec
UPDATE issued_tickets
SET status = 'checked_in', checked_in_at = $2, checked_in_by = $3
WHERE id = $1 AND status = 'issued';

-- name: CreateCheckInOutbox :exec
INSERT INTO ticket_check_in_outbox (event_id, ticket_id, event_type, occurred_at, aggregate_type, aggregate_id, payload)
VALUES (sqlc.arg(event_id)::uuid, sqlc.arg(ticket_id)::uuid, 'ticket.checked-in.v1', sqlc.arg(occurred_at),
    'eventa.ticket.check-in.v1', sqlc.arg(ticket_id)::uuid,
    (SELECT jsonb_build_object('messageId', sqlc.arg(event_id)::uuid, 'eventId', event_id,
        'ticketId', id, 'attendeeId', attendee_id, 'checkedInAt', checked_in_at,
        'type', 'ticket.checked-in.v1')
     FROM issued_tickets WHERE id = sqlc.arg(ticket_id)::uuid));

-- name: ClaimCancellationEvent :one
INSERT INTO ticket_cancellation_inbox (message_id, event_id, event_type)
VALUES ($1, $2, 'event.cancelled.v1')
ON CONFLICT (message_id) DO NOTHING
RETURNING message_id;

-- name: MarkEventCancelled :exec
INSERT INTO ticket_cancelled_events (event_id, cancellation_message_id)
VALUES ($1, $2)
ON CONFLICT (event_id) DO NOTHING;

-- name: ListTicketsForRevocation :many
SELECT id FROM issued_tickets
WHERE event_id = $1 AND status <> 'revoked'
ORDER BY id FOR UPDATE;

-- name: RevokeTicket :exec
UPDATE issued_tickets SET status = 'revoked'
WHERE id = $1 AND event_id = $2 AND status <> 'revoked';

-- name: CreateRevocationOutbox :exec
INSERT INTO ticket_revocation_outbox (event_id, aggregate_type, aggregate_id, event_type, payload, occurred_at)
SELECT sqlc.arg(message_id)::uuid, 'eventa.ticket.revoked.v1', t.id, 'ticket.revoked.v1',
    jsonb_build_object('messageId', sqlc.arg(message_id)::uuid, 'eventId', t.event_id,
        'ticketId', t.id, 'attendeeId', t.attendee_id, 'revokedAt', now(),
        'type', 'ticket.revoked.v1'), now()
FROM issued_tickets t WHERE t.id = sqlc.arg(ticket_id)::uuid;

-- name: MarkCancellationProcessed :exec
UPDATE ticket_cancellation_inbox SET status = 'processed', processed_at = now()
WHERE message_id = $1;
