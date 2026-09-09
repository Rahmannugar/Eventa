# Ticket Service Architecture

Ticket Service owns issued ticket state and QR credential hashes in its PostgreSQL database. Paid-order facts are consumed at least once through the event bus; the inbox and issued-ticket constraints make replay safe. Gin serves health endpoints, while application issuance and broker adapters remain separate from persistence.

Ticket reads are owned by the `tickets` domain. The reader filters by the attendee identity supplied by the authenticated Gateway, uses SQLC for bounded keyset reads, and returns the opaque QR token required by the attendee product. Ticket does not query Commerce or Event databases to enrich the response.

Check-in is owned by the `checkin` domain. Ticket hashes the presented QR secret, locks the matching ticket row, and commits the `issued` to `checked_in` transition with the scanner identity. A unique Ticket-owned outbox row is written in the same transaction; replayed scans observe the durable checked-in state and do not create a second event.
