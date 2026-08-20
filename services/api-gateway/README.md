# Eventa API Gateway

The API Gateway is Eventa's public HTTP boundary. It owns transport validation, request-level security, protocol translation, API documentation, and routing to internal services. It does not own business persistence or business invariants.

## Runtime

- HTTP port: configured by `PORT`; local Compose publishes `3004`.
- Identity dependency: configured by `IDENTITY_GRPC_URL`.
- Event dependency: configured by `EVENT_GRPC_URL`.
- Redis rate-limit dependency: configured by `REDIS_URL`.
- HTTP header, request-body, and keep-alive limits: configured by the corresponding `HTTP_*_TIMEOUT_MS` variables.
- Identity RPC deadline: configured by `IDENTITY_GRPC_DEADLINE_MS`.
- Event RPC deadline: configured by `EVENT_GRPC_DEADLINE_MS`.
- Redis connection and command budgets: configured by `REDIS_CONNECT_TIMEOUT_MS` and `REDIS_OPERATION_TIMEOUT_MS`.
- Interactive API reference: `/docs` when `API_DOCS_ENABLED=true`.
- Liveness: `/health/live`.
- OTLP telemetry destination: configured by `OTEL_EXPORTER_OTLP_ENDPOINT`.
- Deployment label: configured by `DEPLOYMENT_ENVIRONMENT`.

All required variables are listed in `.env.example`. Create the ignored `.env` deliberately before running the service; startup fails when permanent configuration is missing or invalid.

## Commands

Run commands from the repository root.

Run Gateway unit tests.

```bash
pnpm test:unit:gateway
```

Start the Gateway-owned Redis instance and run the real Redis integration suite.

```bash
pnpm test:integration:gateway
```

Run strict TypeScript checking without emitting build output.

```bash
pnpm --filter @eventa/api-gateway typecheck
```

Compile the deployable API Gateway.

```bash
pnpm --filter @eventa/api-gateway build
```

Build and start the complete local Eventa application, including the Gateway and its dependencies.

```bash
pnpm services:start
```

The local stack sends Gateway metrics and traces through Alloy and collects its structured container logs. Open Grafana at `http://localhost:3300`.

## Further Documentation

- [API.md](API.md): public routes, errors, documentation endpoints, and rate-limit metadata.
- [ARCHITECTURE.md](ARCHITECTURE.md): domain modules, shared infrastructure, dependency behavior, and protocol translation.
- [Attendees API](src/domains/attendees/API.md) and [architecture](src/domains/attendees/ARCHITECTURE.md): the domain-owned registration contract and command flow.
- [Events API](src/domains/events/API.md) and [architecture](src/domains/events/ARCHITECTURE.md): authenticated admin event routing and dependency behavior.
