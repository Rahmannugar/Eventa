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

Gateway and Identity
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

The wider product design includes Event, Commerce, Ticket, Discovery, Notification, Analytics, attendee-web, and admin-web capabilities. Each service is an independently deployable modular monolith. These boundaries are architectural decisions, not claims that every service is implemented.

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
- Event bus: durable completed business facts and independent consumers. Kafka is the current adapter choice.
- Job queue: retryable background work assigned to workers. RabbitMQ is the current adapter choice.

Defined multi-service business workflows use orchestration. Independent reactions to completed facts use choreography. Delivery is treated as at least once, so durable commands, jobs, events, webhooks, and workflow steps must be idempotent.

RabbitMQ DLQs are used only for actionable failed work with a defined recovery path, not as a default for every queue. Replaceable, best-effort, and time-bounded jobs use owned failed or expired states, resend, reconciliation, or rebuild behavior instead. Production DLQs are bounded, observable through RabbitMQ and OpenTelemetry signals, alerted through Grafana, and reviewed through audited manual recovery; review automation remains read-only.

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

Discovery combines explicit interests with weighted behavioral signals to build attendee recommendation preferences. Semantic retrieval uses Gemini and Ahnlich only where meaning cannot be expressed reliably through categories or lexical filters. Ahnlich's [official Go SDK documentation](https://ahnlich.dev/docs/client-libraries/go/go-specific-resources/) describes typed gRPC clients for Ahnlich DB and Ahnlich AI, including batching utilities. Ahnlich currently describes the platform as alpha/testing and subject to breaking changes, so Discovery must pin versions and isolate the SDK behind a capability adapter with contract tests, deadlines, bounded retries, observability, and graceful degradation. Implementation must still begin by reviewing the current official documentation rather than relying on remembered APIs.

Event Service remains authoritative for event and venue data. PostGIS provides radius filtering, exact distance ordering, and map/spatial queries after Discovery produces semantic candidate event IDs. Current or selected location is request context, not an Identity field.

## Persistence and Correctness

Each service owns its PostgreSQL schema, migrations, constraints, and database principal. TypeScript services use Drizzle. Go services use GORM for persistence while reviewed, versioned SQL migrations—not `AutoMigrate`—remain the deployment authority. Critical invariants use database constraints and transactions where multiple writes must commit together. Shared databases and cross-service queries are prohibited.

Schema changes are forward migrations. Human-readable migration names describe business intent, and Drizzle's journal remains consistent with TypeScript migration filenames.

## Operations

Permanent configuration is injected through environment variables and validated at startup. Missing service `.env` files or required variables fail local startup rather than being generated automatically. Containers do not bake in application configuration or secrets.

Liveness describes whether a process is alive. Readiness is exposed only when a real local dependency determines whether an instance should receive traffic. Services close owned connections during graceful shutdown.

Gateway and Identity start OpenTelemetry before NestJS loads so HTTP and gRPC transport context propagates automatically. Each instance exports traces and bounded-cardinality request metrics over OTLP to Alloy. HTTP and gRPC boundary components emit structured completion logs and add the active trace ID; the Gateway also validates, returns, and forwards `x-request-id`. Safe error codes and field-rule names explain failed requests without logging submitted values. Successful health probes are excluded from request logs, custom request metrics, and incoming HTTP traces.

Concrete spans expose Redis rate-limit consumption, Argon2id hashing, and the Identity PostgreSQL insert. Generic framework middleware/controller spans are disabled because their inclusive durations do not identify which dependency consumed the time.

Authoritative business outcomes are measured at a domain-owned decorator boundary rather than inside controllers or core command/query handlers.

Alloy is the collection and routing layer. It sends metrics to Prometheus, traces to Tempo, and Docker JSON logs to Loki. Docker logs are grouped as application, infrastructure, or observability services. Grafana provisions those three data sources and the `Attendee Registration Overview` dashboard. Prometheus, Tempo, and Loki retain one day of local data, and Docker JSON logs rotate at two 10 MB files per container. Telemetry backend availability is deliberately not an application readiness dependency: losing observability must not stop registration, while exporter failures remain visible in service diagnostics.

Grafana administration and optional SMTP configuration come from its ignored environment file. Resend SMTP can deliver Grafana alert notifications independently of Eventa's application mail adapter. Alert rules and SMTP delivery are enabled only after an actionable workflow signal exists and the contact point can be tested end to end.

## Performance Validation

After a product story's behavior, observability, dashboards, and actionable monitoring are complete, the full story is audited and locally benchmarked with k6. A dedicated performance environment uses deterministic, service-owned seed tooling to create million-scale datasets without making normal startup, CI, or integration tests depend on that volume.

Synchronous benchmarks cover HTTP, Redis, database operations, response latency, throughput, resource pressure, and error behavior. Asynchronous benchmarks cover event publication, queue delay, consumer processing, retries, idempotency, eventual completion, and end-to-end workflow latency. An asynchronous benchmark measures from the initiating action to the durable terminal business outcome, never merely to producer or queue acknowledgement.

Results are interpreted together with OpenTelemetry traces and Prometheus, Grafana, Loki, and Tempo signals. Each scenario reflects the real endpoint policy; rate limiting and other security boundaries are not silently disabled to manufacture higher throughput. k6 is selected because its scenario model, thresholds, checks, and custom metrics fit both request-response and workflow-level validation.
