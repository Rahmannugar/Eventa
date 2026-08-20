# Eventa Identity Service

Identity owns Eventa's security principals, credentials, verification state, account lifecycle, and sessions. Attendee and admin identities are separate namespaces. The Attendees domain exposes registration, email verification, login, sessions, and password recovery.

## Runtime

- gRPC application port: configured by `GRPC_PORT`; local Compose publishes `50051`.
- HTTP health port: configured by `HEALTH_PORT`; local Compose publishes `3005`.
- PostgreSQL: configured by `DATABASE_URL`; local Compose publishes the database on host port `55432` for development tools.
- Redis temporary OTP and live attendee-session state: configured by `REDIS_URL`; local Compose publishes the Identity-owned Redis instance on host port `57379` for development tools.
- RabbitMQ job queue: configured by `RABBITMQ_URL`; local Compose publishes AMQP on host port `5673`.
- Attendee-auth state protection: configured by `AUTH_HMAC_SECRET`.
- Admin-auth state protection: configured by `ADMIN_AUTH_HMAC_SECRET`.
- OTLP telemetry destination: configured by `OTEL_EXPORTER_OTLP_ENDPOINT`.
- Deployment label: configured by `DEPLOYMENT_ENVIRONMENT`.

All required variables and the local database principal contract are listed in `.env.example`. Create the ignored `.env` deliberately before running Identity.

## Commands

Run commands from the repository root.

Provision an inactive admin email. Repeating the command for the same email leaves the existing account unchanged.

```bash
pnpm admin:provision:identity admin@example.com
```

Build the Identity migration image and apply committed migrations to the local Identity database.

```bash
pnpm db:migrate:identity
```

Delete the local Identity database volume and restart Eventa with fresh Identity state.

```bash
pnpm db:reset:identity
```

Run Identity unit tests.

```bash
pnpm test:unit:identity
```

Start Identity PostgreSQL, Redis, and RabbitMQ, create the isolated test database when missing, and run integrations.

```bash
pnpm test:integration:identity
```

Run strict TypeScript checking without emitting build output.

```bash
pnpm --filter @eventa/identity-service typecheck
```

Compile the deployable Identity Service.

```bash
pnpm --filter @eventa/identity-service build
```

The integration suite requires `TEST_DATABASE_URL`, `TEST_REDIS_URL`, and `TEST_RABBITMQ_URL`. It refuses databases without an `_test` suffix and creates the isolated test database when it is missing.

### Local database

| Host        | Port    | Database          | Username          | Password                   |
| ----------- | ------- | ----------------- | ----------------- | -------------------------- |
| `localhost` | `55432` | `eventa_identity` | `eventa_identity` | `eventa_identity_password` |

The local stack sends Identity metrics and traces through Alloy and collects its structured container logs. Open Grafana at `http://localhost:3300`.

## Further Documentation

- [API.md](API.md): gRPC and health contracts.
- [ARCHITECTURE.md](ARCHITECTURE.md): registration, verification, session-state ownership, constraints, and failure behavior.
- [Attendees API](src/attendees/API.md) and [architecture](src/attendees/ARCHITECTURE.md): the domain-owned contracts, account/session state, and invariants.
