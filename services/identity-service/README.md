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

### Benchmark Data — attendees

Bulk-insert the benchmark attendee set with the repository-owned seeder at `tools/seeder`. It writes `attendee_accounts` rows that are active, verified, and ready to log in, and the matching `discovery_attendee_interests` row in Discovery's database. Accounts are never registered through the API, so seeding sends no verification email.

```bash
SEED_ATTENDEE_PASSWORD=EventaDev!2026 \
IDENTITY_DATABASE_URL=postgres://eventa_identity:eventa_identity_password@127.0.0.1:55432/eventa_identity \
DISCOVERY_DATABASE_URL=postgres://eventa_discovery:eventa_discovery_password@127.0.0.1:60432/eventa_discovery \
go -C tools/seeder run . attendees -count 100 -offset 0
```

`EventaDev!2026` is the shared development password every seeded account receives, and it is the documented value of `SEED_ATTENDEE_PASSWORD` (or the `-password` flag). It is a dataset credential, not a person's secret: keep it in this documentation and your local `.env`, and never bake it into an image. Accounts registered through the API keep their own passwords.

`-count` sets the number of accounts, `-offset` the first generator index, `-batch-size` the accounts per transaction, and `-seed` the generator seed. One seed names 1600 distinct accounts, so `-offset` plus `-count` must stay inside that space, and a range is deterministic: the same seed and range always produce the same accounts, so rerunning one inserts nothing new. Accounts and their interests live in different databases, so a run that stops between them is repaired by rerunning the range.

Check what a run produced:

```bash
docker exec eventa-identity-database-1 psql -U eventa_identity -d eventa_identity -c \
  "SELECT count(*) FROM attendee_accounts WHERE email_verified_at IS NOT NULL AND status = 'active';"
docker exec eventa-discovery-database-1 psql -U eventa_discovery -d eventa_discovery -c \
  "SELECT count(*) FROM discovery_attendee_interests;"
```

A seeded account logs in through the Gateway with its email address and the shared password, and its interests shape the recommendations it receives. The seeder's own suite covers the account and interest contracts:

```bash
go -C tools/seeder test ./...
TEST_IDENTITY_DATABASE_URL=postgres://eventa_identity:eventa_identity_password@127.0.0.1:55432/eventa_identity_test \
TEST_DISCOVERY_DATABASE_URL=postgres://eventa_discovery:eventa_discovery_password@127.0.0.1:60432/eventa_discovery_test \
go -C tools/seeder test -count=1 ./test/integration/...
```

The integration suite creates each disposable database when it is missing and applies that service's committed migrations, so it never touches the local working databases.

### Local database

| Host        | Port    | Database          | Username          | Password                   |
| ----------- | ------- | ----------------- | ----------------- | -------------------------- |
| `localhost` | `55432` | `eventa_identity` | `eventa_identity` | `eventa_identity_password` |

The local stack sends Identity metrics and traces through Alloy and collects its structured container logs. Open Grafana at `http://localhost:3300`.

## Further Documentation

- [API.md](API.md): gRPC and health contracts.
- [ARCHITECTURE.md](ARCHITECTURE.md): registration, verification, session-state ownership, constraints, and failure behavior.
- [Attendees API](src/attendees/API.md) and [architecture](src/attendees/ARCHITECTURE.md): the domain-owned contracts, account/session state, and invariants.
