# Notification Service (Go)

Eventa's notification deployable. It sends attendee and admin email — one-time verification and password codes, plus event-cancellation notices — from durable job state rather than from request handling.

This is the authoritative Notification Service implementation. Its behavior is specified in `local/notification-parity-contract.md`, which was written from the TypeScript implementation it replaces.

## Requirements

- Go 1.26
- PostgreSQL 17 (Compose provides `notification-database`)
- RabbitMQ (Compose provides `job-queue`)
- An OTLP collector reachable at `OTEL_EXPORTER_OTLP_ENDPOINT`
- Kafka, for the cancellation path

## Local setup

```bash
cp .env.example .env       # then fill RESEND_API_KEY
task migrate                # starts the database and applies migrations
task build
task lint
task test:unit

# Integration tests need a disposable database and the migrated schema:
docker compose -f ../../compose.yaml up -d --wait notification-database
TEST_DATABASE_URL=<test database url> task test:integration
```

`TEST_DATABASE_URL` must name a database ending in `_test`; the harness creates
and migrates it if it does not exist yet.

Run the service:

```bash
go run ./cmd/notification-service
```

Through Compose:

```bash
docker compose -f ../../compose.yaml up -d --wait notification-database notification-migration notification-service
curl -s localhost:3006/health/ready
```

## Commands

| Command | What it does |
| --- | --- |
| `task build` | Compiles every package |
| `task test:unit` | Runs short unit tests |
| `task test:integration` | Runs tests against real PostgreSQL. Needs `TEST_DATABASE_URL` |
| `task test` | Both suites. The integration half is skipped without `TEST_DATABASE_URL` |
| `task lint` | `golangci-lint` with the service configuration |
| `task fmt` | Formats `cmd`, `internal`, `test` |
| `task migrate` | Starts the database and applies reviewed SQL migrations |

## Environment

Configuration is read from the service-owned `.env` file. `.env.example` lists every variable and its local value. Startup fails deliberately when a variable is missing or out of range; the validation order and error strings are specified in the parity contract.

## Ownership

Notification Service owns its PostgreSQL schema and migrations, its RabbitMQ job topology, its email delivery state, and its Resend adapter. It resolves attendee addresses and event details from Identity and Event over internal gRPC and never reads another service's database.

See `API.md` for the HTTP contract and `ARCHITECTURE.md` for structure and invariants.
