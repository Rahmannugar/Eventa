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

## Further Documentation

- [API.md](API.md): gRPC and health contract map.
- [ARCHITECTURE.md](ARCHITECTURE.md): service ownership, persistence, audit, and runtime flow.
- [Events API](src/events/API.md) and [architecture](src/events/ARCHITECTURE.md): event-domain contracts and invariants.
