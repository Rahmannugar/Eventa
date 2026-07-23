# Eventa

A distributed event ticketing platform built on a NestJS and Go microservices architecture using gRPC, Kafka, RabbitMQ, PostgreSQL, Redis, OpenTelemetry, and Docker Compose.

https://excalidraw.com/#json=SFbQZx5HysD4qID-yI_WI,BiqyfjSj0iGFfR4oRcvJ_A

## Overview

Eventa is a distributed event ticketing platform that enables organizers to create and manage events, publish tickets, process attendee purchases through Stripe, validate QR code check-ins, issue refunds for cancelled events, deliver semantic and location-aware recommendations using Ahnlich, Gemini, and PostGIS, and provide analytics for organizers.

The system is composed of independently deployable modular-monolith services responsible for identity, events, commerce, ticketing, discovery, analytics, notifications, and an API Gateway. Services communicate using HTTP, gRPC, Kafka, and RabbitMQ, combining synchronous request-response communication with asynchronous event-driven workflows.

The project is designed to explore production engineering practices including distributed transactions, compensating actions, event-driven architecture, observability, background processing, and clear service ownership while remaining fully runnable locally using Docker Compose.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for service ownership, communication boundaries, data ownership, and distributed workflow decisions.

- API Gateway
- Identity Service
- Event Service
- Commerce Service
- Ticket Service
- Discovery Service
- Analytics Service
- Notification Service

Services use explicit application services for business use cases, thin transport controllers, persistence-only repositories, and capability adapters for infrastructure. Separate read models are introduced only when a real access pattern justifies them. Every deployable owns `README.md`, `API.md`, and `ARCHITECTURE.md`; each substantial domain owns concise `API.md` and `ARCHITECTURE.md` files without duplicating machine-readable contracts.

## Technology

### Backend

- NestJS and TypeScript: API Gateway, Identity, Event, Commerce, Analytics, and Notification
- Go: Ticket and Discovery
- GORM
- Drizzle
- PostgreSQL
- Redis
- Kafka
- RabbitMQ
- gRPC
- Stripe
- Resend
- Ahnlich (vector DB, AI proxy)
### AI

- Google Gemini

### Observability

- OpenTelemetry
- Prometheus
- Grafana(Loki, Tempo)


### Frontend

- React
- Vite

### Infrastructure

- Docker Compose
- k6 for local performance testing

## Local Development

For the full command reference, see [commands.md](commands.md).

The current Compose stack starts the API Gateway, Identity Service, its PostgreSQL database, the Redis-backed registration rate-limit store, and the complete local observability pipeline. Identity migrations run in a one-shot container before the service starts.

Start the stack with:

```bash
pnpm services:start
```

Create each service `.env` file from its service-owned `.env.example` before starting Eventa. Missing files and invalid permanent configuration intentionally stop startup.

Create the ignored Grafana `.env` from `infrastructure/observability/dashboards/grafana/.env.example` as well. It owns the local admin credentials and optional Resend SMTP settings; secrets are not stored in Compose or committed configuration.

The migration must complete successfully before Identity starts, and the Gateway waits for healthy Identity and Redis containers.

Current local endpoints:

- API Gateway: `http://localhost:3004`
- Scalar API reference: `http://localhost:3004/docs`
- OpenAPI JSON: `http://localhost:3004/openapi.json`
- OpenAPI YAML: `http://localhost:3004/openapi.yaml`
- Gateway liveness: `http://localhost:3004/health/live`
- Identity readiness: `http://localhost:3005/health/ready`
- Grafana: `http://localhost:3300`
- Grafana Alloy diagnostics: `http://localhost:51234`
- Prometheus: `http://localhost:59090`

Stop the stack without deleting database data:

```bash
pnpm services:stop
```

Use `pnpm db:reset:all` only when you intentionally want to delete and recreate all local databases.

## API Documentation

See [API.md](API.md) for the current public API and internal contract map. While the Gateway is running, Scalar is available at `http://localhost:3004/docs` and the importable OpenAPI contracts are available as JSON and YAML.

Each deployable service also owns its operational, API, and architecture documentation inside its service directory.

## Performance Validation

Eventa uses k6 for local performance validation. k6 scenarios validate both request-response and event-driven work:

- Request-response scenarios measure throughput, latency, errors, and resource pressure across HTTP, Redis, and PostgreSQL.
- Event-driven scenarios measure publication, broker and queue delay, consumer processing, retries, duplicate handling, and eventual workflow completion.

Event-driven latency is measured from the initiating request to the durable terminal business outcome, rather than stopping at broker acknowledgement. Results are evaluated with the corresponding OpenTelemetry traces, Prometheus metrics, Grafana dashboards, Loki logs, and Tempo traces.
