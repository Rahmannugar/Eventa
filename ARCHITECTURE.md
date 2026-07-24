# Eventa Architecture

## System Shape

Eventa is organized as independently deployable services with explicit business ownership. Clients use HTTP through the API Gateway. Services use gRPC for synchronous commands and queries, an event bus for durable business facts, and a job queue for retryable worker assignments.

The local stack contains:

```text
Attendee client
  -> API Gateway
       -> Identity Service
            -> RabbitMQ
                 -> Notification Service
                      -> Email provider

Gateway, Identity, and Notification
  -> service-owned state

Gateway, Identity, and Notification
  -> OpenTelemetry OTLP
       -> Grafana Alloy
            -> Prometheus metrics
            -> Tempo traces

Container stdout/stderr
  -> Grafana Alloy
       -> Loki logs

Grafana
  -> Prometheus, Tempo, and Loki
```

Eventa includes Event, Commerce, Ticket, Discovery, Notification, Analytics, attendee-web, and admin-web capabilities. Each service is an independently deployable modular monolith.

## Ownership

- API Gateway owns public transport, boundary validation, request security, authentication and authorization enforcement, and protocol translation.
- Identity Service owns attendee and admin principals, credentials, verification, and sessions. Attendees and admins remain separate security namespaces.
- Event Service owns events, venues, capacity, ticket types, waitlists, and authoritative geographic data.
- Commerce Service owns the Order and Payment domains plus explicitly named commerce workflows. Order owns orders, order items, discounts, and order state. Payment owns payment attempts, Stripe interaction, webhooks, reconciliation, refunds, receipts, invoices, and all money invariants. They share one Commerce database and migration stream but do not access each other's repositories directly.
- Ticket Service owns issued tickets, QR codes, and check-ins.
- Discovery Service owns explicit attendee interests, behavior-derived recommendation preferences, semantic indexes, and recommendation ranking.
- Notification Service owns delivery and notification history.
- Analytics Service owns reporting projections rather than transactional source data.

No service reads or writes another service's database.

## Application Architecture and Languages

Every deployable is a modular monolith with explicit application services for its business use cases. Controllers own transport translation, application services coordinate domain behavior, repositories own persistence, and infrastructure adapters implement capability ports. Separate query services or projections are added only for concrete read requirements; CQRS is not a platform-wide rule.

API Gateway, Identity, Event, Commerce, Analytics, and Notification use NestJS/TypeScript. Ticket and Discovery use Go.

## Communication

- HTTP: clients to API Gateway.
- gRPC: synchronous internal commands and queries requiring an immediate result.
- Event bus: durable completed business facts and independent consumers. Kafka is the adapter choice.
- Job queue: retryable background work assigned to workers. RabbitMQ is the adapter choice.

Defined multi-service business workflows use orchestration. Independent reactions to completed facts use choreography. Delivery is treated as at least once, so durable commands, jobs, events, webhooks, and workflow steps must be idempotent.

We keep authoritative gRPC schemas in `packages/grpc-contracts/proto`. Pinned Buf tooling checks compatibility and generates the committed TypeScript contracts; loader and deadline behavior stays in narrow handwritten transport code.

RabbitMQ DLQs are used only for actionable failed work with a defined recovery path, not as a default for every queue. Replaceable, best-effort, and time-bounded jobs use owned failed or expired states, resend, reconciliation, or rebuild behavior instead. Production DLQs are bounded, observable through RabbitMQ and OpenTelemetry signals, alerted through Grafana, and reviewed through audited manual recovery;.

We document concrete behavior in the owning service: [API Gateway architecture](services/api-gateway/ARCHITECTURE.md), [Identity architecture](services/identity-service/ARCHITECTURE.md), and [Notification architecture](services/notification-service/ARCHITECTURE.md).

## Persistence and Correctness

Each service owns its PostgreSQL schema, migrations, constraints, and database principal. We use Drizzle in TypeScript services. Go services use GORM for persistence and reviewed SQL migrations as the deployment authority.

## Operations

Liveness describes whether a process is alive. Readiness is exposed only when a real local dependency determines whether an instance should receive traffic. Services close owned connections during graceful shutdown.

We send metrics, traces, and logs through Alloy to Prometheus, Tempo, and Loki, with Grafana as the operational interface. Telemetry availability is not an application readiness dependency.

## Performance Validation

We use k6 after behavior and observability are complete. Synchronous scenarios measure the full request path; asynchronous scenarios measure from the initiating action to the durable terminal outcome. We interpret results with the configured metrics, traces, and logs.
