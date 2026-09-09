-- name: ClaimIssuanceEvent :one
INSERT INTO ticket_issuance_inbox (event_id, event_type)
VALUES ($1, 'commerce.order-paid.v1')
ON CONFLICT (event_id) DO NOTHING
RETURNING event_id;

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
INSERT INTO ticket_check_in_outbox (event_id, ticket_id, event_type, occurred_at)
VALUES ($1, $2, 'ticket.checked-in.v1', $3);

-- name: ListPendingCheckInEvents :many
SELECT o.event_id, o.ticket_id, o.event_type, o.occurred_at
FROM ticket_check_in_outbox o
WHERE o.published_at IS NULL
ORDER BY o.occurred_at, o.event_id
LIMIT $1
FOR UPDATE SKIP LOCKED;

-- name: MarkCheckInEventPublished :exec
UPDATE ticket_check_in_outbox
SET published_at = now()
WHERE event_id = $1 AND published_at IS NULL;

-- name: GetCheckInEvent :one
SELECT o.event_id AS outbox_event_id, t.id AS ticket_id, t.event_id AS event_id,
       t.attendee_id, t.checked_in_at
FROM ticket_check_in_outbox o
JOIN issued_tickets t ON t.id = o.ticket_id
WHERE o.event_id = $1;
