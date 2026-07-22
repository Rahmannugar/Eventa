# Eventa API Gateway

The API Gateway is Eventa's public HTTP boundary. It owns transport validation, request-level security, protocol translation, API documentation, and routing to internal services. It does not own business persistence or business invariants.

## Runtime

- HTTP port: configured by `PORT`; local Compose publishes `3004`.
- Identity dependency: configured by `IDENTITY_GRPC_URL`.
- Redis rate-limit dependency: configured by `REDIS_URL`.
- Interactive API reference: `/docs` when `API_DOCS_ENABLED=true`.
- Liveness: `/health/live`.
- OTLP telemetry destination: configured by `OTEL_EXPORTER_OTLP_ENDPOINT`.
- Deployment label: configured by `DEPLOYMENT_ENVIRONMENT`.

All required variables are listed in `.env.example`. Create the ignored `.env` deliberately before running the service; startup fails when permanent configuration is missing or invalid.

## Commands

Run from the repository root:

```bash
pnpm test:unit:gateway
pnpm test:integration:gateway
pnpm --filter @eventa/api-gateway typecheck
pnpm --filter @eventa/api-gateway build
```

Use `pnpm services:start` to run the complete local registration path.

The local stack sends Gateway metrics and traces through Alloy and collects its structured container logs. Open Grafana at `http://localhost:3300`.

## Further Documentation

- [API.md](API.md): public routes, errors, documentation endpoints, and rate-limit metadata.
- [ARCHITECTURE.md](ARCHITECTURE.md): domain modules, shared infrastructure, dependency behavior, and protocol translation.
- [Attendees API](src/domains/attendees/API.md) and [architecture](src/domains/attendees/ARCHITECTURE.md): the domain-owned registration contract and command flow.
