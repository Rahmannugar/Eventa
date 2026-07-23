# Eventa Identity Service

Identity owns Eventa's security principals, credentials, and verification state. Attendee and admin identities are separate namespaces. The current implementation contains attendee registration and the internal email-verification OTP lifecycle; registration is its only exposed business operation.

## Runtime

- gRPC application port: configured by `GRPC_PORT`; local Compose publishes `50051`.
- HTTP health port: configured by `HEALTH_PORT`; local Compose publishes `3005`.
- PostgreSQL: configured by `DATABASE_URL`; local Compose publishes the database on host port `55432` for development tools.
- Redis temporary OTP state: configured by `REDIS_URL`; local Compose publishes the Identity-owned Redis instance on host port `57379` for development tools.
- OTP subject and value protection: configured by `EMAIL_VERIFICATION_HMAC_SECRET`.
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
