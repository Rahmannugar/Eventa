# Ticket Service Architecture

Ticket Service owns issued ticket state and QR credential hashes in its PostgreSQL database. Paid-order facts are consumed at least once through the event bus; the inbox and issued-ticket constraints make replay safe. Gin serves health endpoints, while application issuance and broker adapters remain separate from persistence.
