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
