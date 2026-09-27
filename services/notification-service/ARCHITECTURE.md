# Architecture

Notification Service is a frameworkless Go deployable. It composes explicit packages with the standard library plus pgx, tern, koanf, and the OpenTelemetry SDK.

## Structure

- `cmd/notification-service` — composition root. Loads and validates configuration, starts telemetry, opens the pool, serves health, and shuts down in that reverse order.
- `cmd/notification-migration` — applies the reviewed SQL migrations in `migrations/` through tern, tracked in `notification_schema_version`.
- `internal/config` — one fixed validation order, so the first failing rule is the reported error.
- `internal/database` — pool construction and the readiness adapter.
- `internal/health` — liveness and readiness over a list of real dependency checkers.
- `internal/telemetry` — OTLP trace and metric exporters, 10-second metric interval, resource attributes naming the service, namespace, version, instance, and environment.

## Data ownership

The service owns `auth_email_deliveries`, `cancellation_email_deliveries`, `notification_job_outbox`, and `ticket_revocation_inbox` in its own PostgreSQL database. Migration `0001_create_notification_delivery_state.sql` creates them.

Durable invariants:

- `ticket_revocation_inbox.message_id` is the primary key, so a replayed fact cannot be recorded twice.
- `cancellation_email_deliveries` is unique on `(event_id, attendee_id)`, so one attendee receives one email per cancelled event.
- `notification_job_outbox` rows are immutable and carry no published flag. The Debezium outbox relay is the only writer to the broker.
- Neither delivery table stores an email address, a one-time code, or message content.

## Delivery model

Work is assigned through RabbitMQ, not handled inside a request. Each delivery record carries status, attempt count, a processing lease, a next-attempt time, and a claim token; the claim and every state transition happen in one transaction under `SELECT … FOR UPDATE`. Resend is called with the delivery or job identifier as its idempotency key, so one durable identifier ties the log line, the row, and the provider message.

Attempts are bounded at three with retry delays of 5 and 30 seconds. There is no dead-letter queue: a replaceable email is not actionable operator work.

## Dependencies

- PostgreSQL — own schema only
- RabbitMQ — job topology and workers
- Kafka — one inbound topic, group-scoped, manual commits
- Identity and Event over internal gRPC, each with an explicit deadline
- Resend — email delivery
- OTLP collector — traces and metrics

Readiness covers only the dependencies the process holds. Telemetry availability never gates startup or readiness.

## Shutdown

SIGTERM or SIGINT stops the HTTP server, drains and closes the pool, then flushes traces and the final metric batch. In-flight messages are left unacknowledged so the broker redelivers them rather than losing them.
