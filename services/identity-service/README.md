# Eventa Identity Service

Identity owns Eventa's security principals, credentials, verification state, and future sessions. Attendee and admin identities are separate namespaces; the current implementation contains attendee registration only.

## Runtime

- gRPC application port: configured by `GRPC_PORT`; local Compose publishes `50051`.
- HTTP health port: configured by `HEALTH_PORT`; local Compose publishes `3005`.
- PostgreSQL: configured by `DATABASE_URL`; local Compose publishes the database on host port `55432` for development tools.
- OTLP telemetry destination: configured by `OTEL_EXPORTER_OTLP_ENDPOINT`.
- Deployment label: configured by `DEPLOYMENT_ENVIRONMENT`.

All required variables and the local database principal contract are listed in `.env.example`. Create the ignored `.env` deliberately before running Identity.

## Commands

Run from the repository root:

```bash
pnpm db:migrate:identity
pnpm test:unit:identity
pnpm test:integration:identity
pnpm db:reset:identity
```

The integration suite requires `TEST_DATABASE_URL`, refuses databases without an `_test` suffix, and creates the isolated test database when it is missing.

The local stack sends Identity metrics and traces through Alloy and collects its structured container logs. Open Grafana at `http://localhost:3300`.

## Further Documentation

- [API.md](API.md): gRPC and health contracts.
- [ARCHITECTURE.md](ARCHITECTURE.md): registration execution, schema ownership, constraints, and failure translation.
- [Attendees API](src/attendees/API.md) and [architecture](src/attendees/ARCHITECTURE.md): the domain-owned registration command, account state, and invariants.
