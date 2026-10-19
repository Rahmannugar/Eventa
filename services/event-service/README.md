# Event Service

Event Service owns event details, venue details, lifecycle rules, ticket currencies and types, capacity, reservations, waitlists, media, and admin event-action audit history. It exposes gRPC business operations to the API Gateway and HTTP health endpoints for local operations.

## Runtime

- gRPC listener: configured by `GRPC_HOST` and `GRPC_PORT`; local Compose publishes `50052`.
- Health listener: configured by `HEALTH_PORT`; local Compose publishes `3007`.
- PostgreSQL dependency: configured by `DATABASE_URL`.
- RabbitMQ retry and reconciliation publication: configured by `RABBITMQ_URL` and bounded connection and confirmation timeouts.
- PostgreSQL outbox delivery: local Compose runs external Debezium lanes for Kafka lifecycle facts and initial RabbitMQ job assignments; Event Service does not own a Kafka client.
- OTLP telemetry destination: configured by `OTEL_EXPORTER_OTLP_ENDPOINT`.
- Deployment label: configured by `DEPLOYMENT_ENVIRONMENT`.

Create the ignored `.env` deliberately from `.env.example`. Startup fails when permanent configuration is missing or invalid. The migration job must complete before the service starts, and readiness succeeds only while PostgreSQL is available.

## Commands

Run commands from the repository root.

### Validation

Check Event source, tests, performance scripts, and Drizzle configuration for lint violations.

```bash
pnpm --filter @eventa/event-service lint
```

Run strict TypeScript checking without emitting build output.

```bash
pnpm --filter @eventa/event-service typecheck
```

Compile the deployable Event Service.

```bash
pnpm --filter @eventa/event-service build
```

Start Event PostgreSQL and run the integration suite against the isolated database configured by `TEST_DATABASE_URL`.

```bash
pnpm test:integration:event
```

Spec files reset the shared test database between tests, so the suite runs them one at a time.

### Database

Build the Event migration image and apply committed migrations to the local Event database.

```bash
pnpm db:migrate:event
```

Delete the local Event database and CDC volumes, then restart the stack with fresh Event state.

```bash
pnpm db:reset:event
```

### Performance

Measure the attendee-availability, reservation-expiry, waitlist-membership, FIFO-position, promotion, and eligibility-cleanup PostgreSQL query paths.

```bash
pnpm --filter @eventa/event-service performance:ticket-capacity-plans
```

The ticket-capacity performance command starts PostgreSQL, applies test migrations, and creates 200 ticket types, 109,500 waitlist entries, and 109,500 reservations inside a rollback-only transaction. It reports execution time, buffer use, plan nodes, and selected indexes without leaving generated records behind.

### Benchmark Data

Bulk-insert the benchmark dataset with the repository-owned seeder at `tools/seeder`. It writes events, venues, categories, ticket currencies and types, and the publication outbox rows directly into the Event database, so Debezium relays the seeded facts through the same lane as admin-published events. It never calls the public API.

```bash
EVENT_DATABASE_URL=postgres://eventa_event:eventa_event_password@127.0.0.1:57432/eventa_event \
IDENTITY_DATABASE_URL=postgres://eventa_identity:eventa_identity_password@127.0.0.1:55432/eventa_identity \
go -C tools/seeder run . events -count 10000 -offset 0 -batch-size 200
```

`-count` sets the number of events, `-offset` the first generator index, `-batch-size` the rows per transaction, and `-seed` the generator seed. Seeded events belong to the first activated admin in the Identity database unless `-admin-id` says otherwise.

Every range is deterministic: the same seed, offset, and count always produce the same rows, so rerunning a range inserts nothing new. Keep the seed and the offsets of a dataset you intend to keep, and use a fresh offset range for throwaway runs.

Check what a run produced:

```bash
docker exec eventa-event-database-1 psql -U eventa_event -d eventa_event -c \
  "SELECT (SELECT count(*) FROM events) AS events, (SELECT count(*) FROM event_publication_outbox WHERE event_type = 'event.published.v1') AS published_facts;"
```

After a run, the facts reach `eventa.event.lifecycle.v1`, Discovery indexes them, and both Discovery search and the Event Service recommendable-events lookup accept them. The seeder's own suite covers that contract:

```bash
go -C tools/seeder test ./...
TEST_DATABASE_URL=postgres://eventa_event:eventa_event_password@127.0.0.1:57432/eventa_event_test go -C tools/seeder test -count=1 ./test/integration/...
```

The integration suite creates the disposable test database when it is missing and applies Event Service's committed migrations, so it never touches the local working database.

## Further Documentation

- [API.md](API.md): gRPC and health contract map.
- [ARCHITECTURE.md](ARCHITECTURE.md): service ownership, persistence, audit, and runtime flow.
- [Events API](src/events/API.md) and [architecture](src/events/ARCHITECTURE.md): event-domain contracts and invariants.
