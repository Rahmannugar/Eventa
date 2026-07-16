# Eventa Architecture

## System Shape

Eventa is organized as independently deployable services with explicit business ownership. Clients use HTTP through the API Gateway. Services use gRPC for synchronous commands and queries, an event bus for durable business facts, and a job queue for retryable worker assignments.

The currently running local slice contains:

```text
Attendee client
  -> API Gateway
       -> Redis rate-limit store
       -> Identity Service over gRPC
            -> Identity PostgreSQL
```

The wider product design includes Event, Order, Payment, Ticket, Discovery, Notification, Analytics, attendee-web, and admin-web capabilities. These boundaries are architectural decisions, not claims that every service is implemented.

## Ownership

- API Gateway owns public transport, boundary validation, request security, authentication and authorization enforcement, and protocol translation.
- Identity Service owns attendee and admin principals, credentials, verification, and sessions. Attendees and admins remain separate security namespaces.
- Event Service owns events, venues, capacity, ticket types, waitlists, and authoritative geographic data.
- Order Service owns orders and order state.
- Payment Service owns provider interaction, payment attempts, refunds, receipts, and invoices.
- Ticket Service owns issued tickets, QR codes, and check-ins.
- Discovery Service owns explicit attendee interests, behavior-derived recommendation preferences, semantic indexes, and recommendation ranking.
- Notification Service owns delivery and notification history.
- Analytics Service owns reporting projections rather than transactional source data.

No service reads or writes another service's database.

## Communication

- HTTP: clients to API Gateway.
- gRPC: synchronous internal commands and queries requiring an immediate result.
- Event bus: durable completed business facts and independent consumers. Kafka is the current adapter choice.
- Job queue: retryable background work assigned to workers. RabbitMQ is the current adapter choice.

Defined multi-service business workflows use orchestration. Independent reactions to completed facts use choreography. Delivery is treated as at least once, so durable commands, jobs, events, webhooks, and workflow steps must be idempotent.

## Current Registration Flow

The Gateway applies an atomic Redis hybrid rate limit before DTO validation, Argon2id, or gRPC work. Admitted requests are validated and sent to Identity. Identity independently validates the gRPC command, canonicalizes email and username, hashes the password, and performs one PostgreSQL insert. Database constraints are the final authority for canonical email and username uniqueness under concurrency.

See [services/api-gateway/ARCHITECTURE.md](services/api-gateway/ARCHITECTURE.md) and [services/identity-service/ARCHITECTURE.md](services/identity-service/ARCHITECTURE.md) for the concrete boundaries.

## Ticket Purchase Workflow

The accepted purchase sequence is:

1. create a pending order;
2. temporarily reserve capacity;
3. create and confirm payment through Stripe;
4. receive or reconcile authoritative payment status;
5. finalize the reservation;
6. issue the ticket;
7. complete the order;
8. publish business facts for independent consumers.

Stripe webhooks are the primary provider-update path. Scheduled reconciliation is a recovery backstop.

## Discovery and Geography

Discovery combines explicit interests with weighted behavioral signals to build attendee recommendation preferences. Semantic retrieval uses Gemini and Ahnlich only where meaning cannot be expressed reliably through categories or lexical filters. Before implementing the Ahnlich adapter, Eventa must review the current official Ahnlich documentation and follow its supported production practices rather than relying on remembered APIs.

Event Service remains authoritative for event and venue data. PostGIS provides radius filtering, exact distance ordering, and map/spatial queries after Discovery produces semantic candidate event IDs. Current or selected location is request context, not an Identity field.

## Persistence and Correctness

Each service owns its PostgreSQL schema, Drizzle migrations, constraints, and database principal. Critical invariants use database constraints and transactions where multiple writes must commit together. Shared databases and cross-service queries are prohibited.

Schema changes are forward migrations. Human-readable migration names describe business intent and Drizzle's journal remains consistent with those names.

## Operations

Permanent configuration is injected through environment variables and validated at startup. Missing service `.env` files or required variables fail local startup rather than being generated automatically. Containers do not bake in application configuration or secrets.

Liveness describes whether a process is alive. Readiness is exposed only when a real local dependency determines whether an instance should receive traffic. Services close owned connections during graceful shutdown.

## Performance Validation

Eventa will run dedicated performance testing after a major business workflow or product story is complete, not after each implementation slice. The selected load generator will send controlled HTTP traffic through the API Gateway after that workflow and its observability instrumentation are implemented. A dedicated performance environment will use deterministic, service-owned seed tooling to create million-scale datasets without making normal startup, CI, or integration tests depend on that volume.

Load-test results will be interpreted together with OpenTelemetry traces and Prometheus, Grafana, Loki, and Tempo signals. Performance runs will measure throughput, latency percentiles, error rate, resource saturation, database and Redis behavior, and cross-service trace continuity. Each scenario will reflect the real endpoint policy; rate limiting and other security boundaries will not be silently disabled to manufacture higher throughput. Autocannon is the current candidate, subject to a deliberate tool comparison before the first performance milestone.
