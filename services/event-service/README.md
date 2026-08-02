# Event Service

Event Service owns Eventa's event records, event-owned venue details, lifecycle rules, optimistic draft editing, and admin event-action audit history. It exposes gRPC business operations to the API Gateway and HTTP health endpoints for local operations.

## Runtime

- gRPC listener: configured by `GRPC_HOST` and `GRPC_PORT`; local Compose publishes `50052`.
- Health listener: configured by `HEALTH_PORT`; local Compose publishes `3007`.
- PostgreSQL dependency: configured by `DATABASE_URL`.
- OTLP telemetry destination: configured by `OTEL_EXPORTER_OTLP_ENDPOINT`.
- Deployment label: configured by `DEPLOYMENT_ENVIRONMENT`.

Create the ignored `.env` deliberately from `.env.example`. Startup fails when permanent configuration is missing or invalid. The migration job must complete before the service starts, and readiness succeeds only while PostgreSQL is available.

## Commands

See [commands.md](commands.md) for Event-owned validation and migration commands.

## Further Documentation

- [API.md](API.md): gRPC and health contract map.
- [ARCHITECTURE.md](ARCHITECTURE.md): service ownership, persistence, audit, and runtime flow.
- [Events API](src/events/API.md) and [architecture](src/events/ARCHITECTURE.md): event-domain contracts and invariants.
