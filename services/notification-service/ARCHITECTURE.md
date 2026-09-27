# Architecture

Notification Service is a frameworkless Go deployable. It composes explicit packages with the standard library plus pgx, tern, koanf, amqp091-go, and the OpenTelemetry SDK.

## Structure

- `cmd/notification-service` — composition root. Loads and validates configuration, starts telemetry, opens the pool, connects to the broker, starts the auth consumers, serves health, and shuts down in that reverse order.
- `cmd/notification-migration` — applies the reviewed SQL migrations in `migrations/` through tern, tracked in `notification_schema_version`.
- `internal/config` — one fixed validation order, so the first failing rule is the reported error.
- `internal/database` — pool construction, the migration runner, and the readiness adapter.
- `internal/auth` — the four auth jobs: their definitions, payload validation, templates, delivery engine, claim repository, and RabbitMQ consumer.
- `internal/email` — the outbound-mail contract, the provider failure contract, the Resend adapter, and the recipient-address check.
- `internal/messaging/rabbitmq` — one process-long connection, channels memoised by purpose, publisher confirms, and the readiness adapter.
- `internal/messaging/topology` — the quorum work queues and their single-message-TTL delay queues.
- `internal/health` — liveness and readiness over a list of real dependency checkers.
- `internal/logging` — the Eventa log envelope.
- `internal/metrics` — the job counter, duration histogram, and in-flight gauge.
- `internal/telemetry` — OTLP trace and metric exporters, 10-second metric interval, the resource attributes naming the service, and W3C propagation over broker headers.
- `internal/errtype` — the `error.type` value recorded on spans and logs.

## Auth jobs

Identity publishes four jobs: attendee email verification, attendee password reset, admin activation, and admin password reset. Each has its own quorum queue, two delay queues, and a definition carrying its queue, job type, operation name, secret payload field, and template. One consumer implementation runs all four.

A job passes through validate, claim, send, and record. Validation accepts only the exact payload and its matching broker properties; anything else is acknowledged without delivery and written as a `rejected` row. Claiming inserts the row when it is new, locks it, and returns claimed, busy, conflict, or terminal. Sending renders the template and calls Resend with the job identifier as the idempotency key. Recording writes delivered, expired, failed, or retry_scheduled under the claim token.

Attempts are bounded at three with retry delays of 5 and 30 seconds. A retry is republished to `<queue>.retry.<n>ms`, where the broker releases it when its time-to-live elapses. Trace context travels in the retry's headers so every attempt shares one trace.

## Data ownership

The service owns `auth_email_deliveries`, `cancellation_email_deliveries`, `notification_job_outbox`, and `ticket_revocation_inbox` in its own PostgreSQL database. Migration `0001_create_notification_delivery_state.sql` creates them.

Durable invariants:

- `auth_email_deliveries.job_id` is the primary key, so one job has one delivery row.
- `auth_email_deliveries.status` is constrained to the seven allowed states and `attempt_count` to 0–3, both by database checks.
- A terminal state can only be left by a matching claim token; a stale token changes no rows.
- `ticket_revocation_inbox.message_id` is the primary key, so a replayed fact cannot be recorded twice.
- `cancellation_email_deliveries` is unique on `(event_id, attendee_id)`, so one attendee receives one email per cancelled event.
- `notification_job_outbox` rows are immutable and carry no published flag. The Debezium outbox relay is the only writer to the broker.
- Neither delivery table stores an email address, a one-time code, or message content.

## Dependencies

- PostgreSQL — own schema only
- RabbitMQ — auth job queues, delay queues, and the retry publishes
- Kafka — one inbound topic, group-scoped, manual commits
- Identity and Event over internal gRPC, each with an explicit deadline
- Resend — email delivery
- OTLP collector — traces and metrics

Readiness covers only the dependencies the process holds: a pool ping and the state of its own broker connection. It never probes the broker, Resend, Identity, Event, Kafka, or the collector, and telemetry availability never gates startup or readiness.

## Shutdown

SIGTERM or SIGINT stops the HTTP server, cancels the consumer tags, closes the broker connection, drains the pool, then flushes traces and the final metric batch. In-flight messages are left unacknowledged so the broker redelivers them rather than losing them.
