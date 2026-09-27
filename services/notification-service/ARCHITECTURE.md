# Architecture

Notification Service is a frameworkless Go deployable. It composes explicit packages with the standard library plus pgx, tern, koanf, amqp091-go, kafka-go, gRPC, and the OpenTelemetry SDK.

## Structure

- `cmd/notification-service` — composition root. Loads and validates configuration, starts telemetry, opens the pool, connects to the broker, declares the cancellation topology, dials Identity and Event, starts the auth consumers, the cancellation job consumer and the Kafka fact consumer, serves health, and shuts them down in the reverse order.
- `cmd/notification-migration` — applies the reviewed SQL migrations in `migrations/` through tern, tracked in `notification_schema_version`.
- `internal/config` — one fixed validation order, so the first failing rule is the reported error.
- `internal/database` — pool construction, the migration runner, and the readiness adapter.
- `internal/auth` — the four auth jobs: their definitions, payload validation, templates, delivery engine, claim repository, and RabbitMQ consumer.
- `internal/cancellation` — event-cancellation email: the revocation fact, the job payload contract, the ingest transaction, the delivery engine and repository, the template, and the RabbitMQ job consumer.
- `internal/lookup` — the narrow Identity and Event gRPC clients the cancellation path calls, each with its own deadline.
- `internal/gen` — generated protobuf and gRPC stubs, committed so the image build needs no protoc. `task proto` regenerates them from `packages/grpc-contracts`.
- `internal/email` — the outbound-mail contract, the provider failure contract, the Resend adapter, and the recipient-address check.
- `internal/messaging/rabbitmq` — one process-long connection, channels memoised by purpose, publisher confirms, and the readiness adapter.
- `internal/messaging/kafka` — one group member over one topic: manual commits, restart backoff, and trace-header extraction.
- `internal/messaging/topology` — the quorum work queues, their single-message-TTL delay queues, and the direct exchange the outbox relay publishes onto.
- `internal/health` — liveness and readiness over a list of real dependency checkers.
- `internal/logging` — the Eventa log envelope.
- `internal/metrics` — the job counter, duration histogram, in-flight gauge, and business outcome counter.
- `internal/telemetry` — OTLP trace and metric exporters, 10-second metric interval, the resource attributes naming the service, and W3C propagation over broker and gRPC headers.
- `internal/errtype` — the `error.type` value recorded on spans and logs.

## Auth jobs

Identity publishes four jobs: attendee email verification, attendee password reset, admin activation, and admin password reset. Each has its own quorum queue, two delay queues, and a definition carrying its queue, job type, operation name, secret payload field, and template. One consumer implementation runs all four.

A job passes through validate, claim, send, and record. Validation accepts only the exact payload and its matching broker properties; anything else is acknowledged without delivery and written as a `rejected` row. Claiming inserts the row when it is new, locks it, and returns claimed, busy, conflict, or terminal. Sending renders the template and calls Resend with the job identifier as the idempotency key. Recording writes delivered, expired, failed, or retry_scheduled under the claim token.

Attempts are bounded at three with retry delays of 5 and 30 seconds. A retry is republished to `<queue>.retry.<n>ms`, where the broker releases it when its time-to-live elapses. Trace context travels in the retry's headers so every attempt shares one trace.

## Cancellation email

Ticket Service revokes every ticket of a cancelled event and appends one `ticket.revoked.v1` fact per ticket to its own outbox. Its Debezium lane publishes those facts to `eventa.ticket.revoked.v1`; we read the topic as one group member with manual commits.

We decide what a record means before we write anything. A fact of another type is ignored. A record we cannot read is logged and left uncommitted, so the broker redelivers it until the producer that wrote it is corrected — the record is never silently dropped, and the error log is the signal that recovery is owed.

An accepted fact enters one transaction that writes the inbox row, the delivery row, and the outbox row together. A replayed `messageId` writes nothing. A second revocation for an attendee we already cover keeps its inbox row and stops, because `cancellation_email_deliveries` is unique on `(event_id, attendee_id)`.

Debezium — not this process — relays the outbox row onto the `eventa.notification.jobs` exchange under the cancellation queue's routing key. We declare the exchange, the queue, and its delay queues at startup, before any job can arrive.

The job consumer reads the payload alone, because a relayed message carries no properties. It claims the delivery, resolves the attendee address from Identity and the event content from Event over gRPC, renders the template, sends through Resend with the delivery id as the idempotency key, and records the outcome under the claim token. A retryable failure schedules the next attempt and republishes to the delay queue; a terminal one is written as `failed` or `rejected`. Attempts are bounded at three with retry delays of 5 and 30 seconds, the same ladder as the auth path.

The durable row never holds an address or a message body: both are read at send time.

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
- RabbitMQ — auth job queues, the cancellation exchange and queue, delay queues, and the retry publishes
- Kafka — the ticket revocation topic, group-scoped, manual commits
- Identity and Event over internal gRPC, each with an explicit deadline
- Resend — email delivery
- OTLP collector — traces and metrics

Readiness covers only the dependencies the process holds: a pool ping and the state of its own broker connection. It never probes the broker, Resend, Identity, Event, Kafka, or the collector, and telemetry availability never gates startup or readiness.

## Shutdown

SIGTERM or SIGINT stops the HTTP server, leaves the Kafka group, cancels the consumer tags, closes the gRPC connections and the broker connection, drains the pool, then flushes traces and the final metric batch. In-flight messages are left unacknowledged so the broker redelivers them rather than losing them.
