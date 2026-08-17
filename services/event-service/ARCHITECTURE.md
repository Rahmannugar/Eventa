# Event Service Architecture

## Responsibility

Event Service owns event state, ticket types, capacity, event lifecycle rules, authoritative published-event filtering, and durable audit history for admin event mutations. It owns its PostgreSQL database and never reads Identity data. The authenticated admin ID arrives through the Gateway's internal gRPC command.

Any authenticated admin may manage any event. `created_by_admin_id` records provenance and does not grant exclusive ownership.

## Modules

- `events` owns event business logic, persistence, transactional outbox writes, media verification and object-deletion jobs, audit records, and domain documentation.
- `database` owns the PostgreSQL client, Drizzle database, migrations, and shutdown.
- `infrastructure` owns the shared RabbitMQ client and Cloudflare R2 adapter. Debezium is deployed beside the service as CDC infrastructure rather than embedded in the application process.
- `health` exposes liveness and database-backed readiness.
- `config` validates permanent runtime configuration before listeners start.

Controllers translate gRPC. Application services own use-case behavior. Repositories own persistence. Operational observation wraps the application capability without coupling core event behavior to telemetry.

## Persistence and Audit

The `events` table is authoritative event state, including recoverable draft retirement. `event_venues` stores one event-owned venue address. `event_ticket_currencies` stores the unique currencies an event offers, and every `event_ticket_types` row references one of those currency parents while storing its normalized catalogue entry, integer minor-unit face value, capacity, and sales window. `event_media` stores only verified R2 objects in one cover slot and four fixed gallery slots. `event_media_uploads` is the durable authority for pending verification, claims, retry timing, terminal outcomes, and rejected-object deletion. `event_media_object_deletions` owns retry and terminal state for formerly accepted objects removed by replacement or explicit removal. RabbitMQ messages contain only the owning record ID and never replace PostgreSQL state. `event_publication_outbox` is an immutable source of lifecycle facts, and `event_job_outbox` is an immutable source of initial media job assignments.

Every event carries a monotonically increasing version. A draft update changes the event only when its expected version matches, increments the version, upserts the venue, and appends `event.updated` in one transaction. This prevents silent overwrites when admins edit concurrently.

The append-only `event_admin_audit_log` records state-changing admin actions and the resulting event version. Draft creation inserts the event and `event.created` audit row in one transaction. Media intent appends `event.media_upload_requested`. Successful verification attaches or atomically replaces media, increments the event version, and appends `event.media_attached` or `event.media_replaced`. Explicit removal increments the version and appends `event.media_removed`. Publication atomically changes the status, records the publication time, increments the version, appends `event.published`, and inserts the versioned Kafka fact into the outbox. Draft retirement atomically timestamps the row, increments the version, and appends `event.retired`; repeated delivery returns the stored result without another audit entry. Each formerly accepted object receives durable deletion work in the same replacement or removal transaction. Mutation, audit, or outbox failure rolls back the complete state change.

Reads do not create durable audit rows. They remain visible through bounded request metrics, traces, and structured operational logs.

The public read repository selects by event ID and `published` status in the same query, then loads the event-owned venue and verified media. Draft and missing IDs are indistinguishable at the gRPC boundary. Its dedicated response omits creator provenance and draft lifecycle state.

## Runtime

Event Service exposes gRPC for business traffic and HTTP for health. PostgreSQL is a real readiness dependency. Business transactions append immutable outbox rows with their state changes. Separate Debezium lanes read PostgreSQL logical WAL and route lifecycle facts to Kafka and initial media jobs to RabbitMQ.

One startup-owned RabbitMQ connection supplies purpose-specific consumer and recovery-publisher channels. Media dispatchers poll durable job state only for retry and reconciliation. The idempotent verification worker validates object size, image type, dimensions, and ETag before attachment or replacement. Missing objects and transient R2 failures retry within their deadlines. Both deletion paths are idempotent, stop after ten failures, and use no DLQ.

CDC delivery is at least once. Kafka consumers must deduplicate the fact ID and event version, and RabbitMQ workers rely on their durable PostgreSQL records and idempotent claims. No deployable consumes `eventa.event.lifecycle.v1`; a purpose-built consumer belongs to the future product story that owns its reaction and recovery policy.

OpenTelemetry exports service identity, request and job metrics, business outcomes, traces, and structured logs without making the collector a readiness dependency.
