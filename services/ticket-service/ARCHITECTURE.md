# Ticket Service Architecture

Ticket Service owns issued ticket state and QR credential hashes in its PostgreSQL database. Paid-order facts are consumed at least once through the event bus; the inbox and issued-ticket constraints make replay safe. Gin serves health endpoints, while application issuance and broker adapters remain separate from persistence.

Ticket reads are owned by the `tickets` domain. The reader filters by the attendee identity supplied by the authenticated Gateway, uses SQLC for bounded keyset reads, and returns the opaque QR token required by the attendee product. Ticket does not query Commerce or Event databases to enrich the response.
