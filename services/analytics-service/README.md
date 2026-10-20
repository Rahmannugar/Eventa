# Analytics Service (Go)

Eventa's analytics deployable. It projects the business facts other services emit into an event performance report that the Admin Dashboard reads, and serves that report over gRPC. It owns no source-of-truth records: Commerce owns orders and payments, Ticket owns issued tickets, Event owns event lifecycle, and this service owns only the derived report and the inbox that makes the fact stream idempotent.

## Requirements

- Go 1.26
- PostgreSQL 17 (Compose provides `analytics-database`)
- Kafka (Compose provides `event-bus`), for the commerce order, ticket check-in, ticket revoked, and event lifecycle topics
- An OTLP collector reachable at `OTEL_EXPORTER_OTLP_ENDPOINT`

## Local setup

```bash
cp .env.example .env
task migrate                # starts the database and applies migrations
task build
task lint
task test:unit

# Integration tests need a disposable database and the migrated schema:
docker compose -f ../../compose.yaml up -d --wait analytics-database
TEST_DATABASE_URL=<test database url> task test:integration
```

`TEST_DATABASE_URL` must name a database ending in `_test`; the harness creates and migrates it if it does not exist yet.

Run the service:

```bash
go run ./cmd/analytics-service
```

Through Compose:

```bash
docker compose -f ../../compose.yaml up -d --wait analytics-database analytics-migration analytics-service
curl -s localhost:3009/health/ready
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
| `task proto` | Regenerates the gRPC stubs from `packages/grpc-contracts` |
| `task migrate` | Starts the database and applies the migrations |

The Kafka consumers need the running stack: `event-bus` plus the topics the `.env` names. A consumer that cannot reach its topic retries with bounded backoff and never advances its offset.
