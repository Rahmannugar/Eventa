# Discovery Service (Go)

Eventa's discovery deployable. It maintains the Discovery-owned projection of published and cancelled events that structured search and semantic recommendation both read from. Event Service remains the source of truth; nothing here owns an event record.

## Requirements

- Go 1.26
- PostgreSQL 17 (Compose provides `discovery-database`)
- Kafka (Compose provides `event-bus`), for the `eventa.event.lifecycle.v1` topic
- Event Service, for resolving published event content over gRPC
- Ahnlich AI proxy (Compose provides `ahnlich-db` and `ahnlich-ai`), for the derived semantic index
- An OTLP collector reachable at `OTEL_EXPORTER_OTLP_ENDPOINT`

## Local setup

```bash
cp .env.example .env
task migrate                # starts the database and applies migrations
task build
task lint
task test:unit

# Integration tests need a disposable database and the migrated schema:
docker compose -f ../../compose.yaml up -d --wait discovery-database
TEST_DATABASE_URL=<test database url> task test:integration

# The semantic cases additionally need the real Ahnlich AI proxy:
docker compose -f ../../compose.yaml up -d --wait ahnlich-db ahnlich-ai
TEST_DATABASE_URL=<test database url> TEST_AHNLICH_AI_URL=localhost:1370 task test:integration

# The recommendation cases additionally need the running Event Service:
TEST_DATABASE_URL=<test database url> TEST_AHNLICH_AI_URL=localhost:1370 \
  TEST_EVENT_GRPC_URL=localhost:50052 task test:integration
```

`TEST_DATABASE_URL` must name a database ending in `_test`; the harness creates and migrates it if it does not exist yet. Cases that read or write the semantic store run only when `TEST_AHNLICH_AI_URL` names a running proxy and are skipped otherwise, and recommendation cases that resolve candidates run only when `TEST_EVENT_GRPC_URL` names a running Event Service. The first proxy start downloads its embedding model into the `ahnlich-ai-models` volume.

Run the service:

```bash
go run ./cmd/discovery-service
```

Through Compose:

```bash
docker compose -f ../../compose.yaml up -d --wait discovery-database discovery-migration discovery-service
curl -s localhost:3011/health/ready
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
| `task proto` | Regenerates the gRPC stubs in `internal/gen` from `packages/grpc-contracts` |
| `task proto:check` | Regenerates and fails when `internal/gen` differs from the committed stubs |
| `task migrate` | Starts the database and applies reviewed SQL migrations |
| `task reindex` | Rebuilds the derived semantic store from the projection |

## Environment

Configuration is read from the service-owned `.env` file. `.env.example` lists every variable and its local value. Startup fails deliberately when a variable is missing or out of range; the validation order and error strings are specified by `internal/config`.

## Ownership

Discovery Service owns its PostgreSQL schema and migrations, the Discovery event projection, and the derived semantic index. It reads the shared lifecycle Kafka topic with a durable inbox, resolves published content from Event Service over internal gRPC, and never reads another service's database.

The service holds no public business surface of its own. Attendees reach search through `GET /search/events` on the API Gateway, which calls this service over internal gRPC on `GRPC_PORT`.

See `API.md` for the HTTP and gRPC contracts and `ARCHITECTURE.md` for structure and invariants.
