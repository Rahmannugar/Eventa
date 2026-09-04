# Ticket Service

Ticket Service owns issued tickets, QR credentials, validation, revocation, and check-in. It is a Go service with Gin, pgx/sqlc, Tern migrations under `migrations/`, Koanf configuration, and durable at-least-once issuance processing.

## Commands

Run `task build`, `task test`, `task lint`, and `task fmt` from this directory. Set `DATABASE_URL` and optionally `HEALTH_ADDRESS` before starting the binary.
