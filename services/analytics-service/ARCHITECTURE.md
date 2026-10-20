# Architecture

Analytics is a Go deployable that turns the business facts other services emit into one report the Admin Dashboard reads. It owns the report and the inbox that makes the fact stream idempotent; it owns no source-of-truth record.

## Structure

- `cmd/analytics-service` — the runtime: configuration, telemetry, pool, four supervised consumers, health server, gRPC server.
- `cmd/analytics-migration` — one-shot reviewed migrations.
- `internal/facts` — one parser and validation contract for every projected fact type.
- `internal/performance` — the projection: inbox claim plus projection row in one transaction per fact.
- `internal/reporting` — the read API over the projection.
- `internal/server` — the gRPC listener and the trace, measure, and log interceptors.
- `internal/database`, `internal/health`, `internal/logging`, `internal/metrics`, `internal/telemetry`, `internal/messaging/kafka` — process infrastructure shared in shape with the other Go services.
- `migrations` — reviewed, versioned SQL; the deployment authority for the schema.

## Projection consumers

Four group members run over four topics, all sharing one ingest path:

- `eventa.commerce.order.v1` — `commerce.order-paid.v1` adds tickets and gross revenue; `commerce.order-refunded.v1` adds refunded tickets and refunded revenue.
- `eventa.ticket.check-in.v1` — `ticket.checked-in.v1` adds checked-in tickets.
- `eventa.ticket.revoked.v1` — `ticket.revoked.v1` adds revoked tickets.
- `eventa.event.lifecycle.v1` — `event.published.v1` records the publication; `event.cancelled.v1` records the cancellation.

Each consumer has its own group and client ID, so one stalled stream never blocks its siblings. The broker offsets advance only after the transaction that claims and applies the fact commits; a failure leaves the offset alone and the record is redelivered after the restart backoff.

## Inbox and idempotency

Every fact carries a stable identity: its message ID, or its event ID for `event.published.v1`, which Event Service writes at most once per event. That identity is claimed in `analytics_event_inbox` inside the same transaction as the projection update, so a replayed fact is a duplicate no-op and delivery is at-least-once without double counting.

## Projection model

`analytics_event_performance` is one row per event: status, currency, per-fact-type ticket counters, gross and refunded revenue in minor units, and the lifecycle timestamps. Currency comes from the order snapshot and the first fact wins; net revenue is derived at read time from its parts so it cannot drift. Revenue is never summed across currencies into one number: the portfolio summary reports per-currency totals.

A fact for an event that has no row yet creates it, so a late-arriving revenue fact for an event whose publish was missed still reports honestly. A cancelled fact for an unknown event inserts a tombstone.

## Read API

`internal/reporting` answers three RPCs over the projection: one page of rows with an exact total, one event's row, and the portfolio summary. It never writes, never crosses into another service's database, and reports an unknown event as `NOT_FOUND` rather than an error.

## Data ownership

| Table | Owner | Purpose |
| --- | --- | --- |
| `analytics_event_inbox` | Analytics | Durable claim of every applied fact |
| `analytics_event_performance` | Analytics | The projected report |

Commerce owns orders and payments. Ticket owns issued tickets and revocation. Event owns event lifecycle. Analytics copies nothing authoritative; every row is derived from facts.

## Dependencies

- PostgreSQL 17 (Compose provides `analytics-database`), for the inbox and the projection.
- Kafka (Compose provides `event-bus`), for the four topics above.
- An OTLP collector, for traces and metrics under the shared meter name.

Analytics dials no other service. Facts arrive complete over Kafka, so the read path depends on nothing but its own database.

## Shutdown

SIGINT or SIGTERM stops accepting work: the health server drains, the gRPC server graceful-stops with a deadline, each consumer stops and leaves its group, the pool closes, and telemetry flushes.
