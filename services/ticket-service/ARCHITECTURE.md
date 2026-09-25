# Ticket Service Architecture

Ticket Service owns issued ticket state and QR credential hashes in its PostgreSQL database. Paid-order facts are consumed at least once through the event bus; the inbox and issued-ticket constraints make replay safe. The shared Commerce order topic also carries other order lifecycle facts, which Ticket acknowledges without acting on them. Gin serves health endpoints, while application issuance and broker adapters remain separate from persistence.

Ticket reads are owned by the `tickets` domain. The reader filters by the attendee identity supplied by the authenticated Gateway, uses SQLC for bounded keyset reads, and returns the opaque QR token required by the attendee product. Ticket does not query Commerce or Event databases to enrich the response.

Check-in is owned by the `checkin` domain. Ticket hashes the presented QR secret, locks the matching ticket row, and commits the `issued` to `checked_in` transition with the scanner identity. A unique immutable Ticket-owned outbox row is written in the same transaction; replayed scans observe the durable checked-in state and do not create a second event.

Cancellation is owned by the `cancellation` domain. A Kafka consumer claims each Event cancellation message by its distinct message ID in a Ticket-owned inbox, preserves the cancelled Event state against delayed issuance, locks all tickets for the Event, transitions them to `revoked`, and writes one immutable revocation outbox row per Ticket in the same transaction.

Ticket business facts use stable message IDs for downstream deduplication and Ticket IDs as Kafka keys for per-Ticket lifecycle ordering. A Ticket-owned Debezium lane reads committed check-in and revocation outbox inserts from PostgreSQL WAL and routes them to Kafka. Ticket does not poll these rows, update them as published, or own an application Kafka producer for their publication.
