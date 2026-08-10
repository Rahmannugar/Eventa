# Event Service Architecture

## Responsibility

Event Service owns event state, event lifecycle rules, and durable audit history for admin event mutations. It owns its PostgreSQL database and never reads Identity data. The authenticated admin ID arrives through the Gateway's internal gRPC command.

Any authenticated admin may manage any event. `created_by_admin_id` records provenance and does not grant exclusive ownership.

## Modules

- events owns event business logic, persistence, publication via the outbox relay, media verification and object-deletion jobs, audit records, and domain documentation.
- `database` owns the PostgreSQL client, Drizzle database, migrations, and shutdown.
- `infrastructure` owns the shared RabbitMQ and Kafka clients and Cloudflare R2 adapter.
- `health` exposes liveness and database-backed readiness.
- `config` validates permanent runtime configuration before listeners start.

Controllers translate gRPC. Application services own use-case behavior. Repositories own persistence. Operational observation wraps the application capability without coupling core event behavior to telemetry.

## Persistence and Audit

The `events` table is authoritative event state. `event_venues` stores one event-owned venue address. `event_media` stores only verified R2 objects in one cover slot and four fixed gallery slots. `event_media_uploads` is the durable authority for pending verification, claims, retry timing, terminal outcomes, and rejected-object deletion. `event_media_object_deletions` owns retry and terminal state for formerly accepted objects removed by replacement or explicit removal. RabbitMQ messages contain only the owning record ID and never replace PostgreSQL state. `event_publication_outbox` owns durable publication facts, relay claims, attempts, retry timing, and successful broker publication state.

Every event carries a monotonically increasing version. A draft update changes the event only when its expected version matches, increments the version, upserts the venue, and appends `event.updated` in one transaction. This prevents silent overwrites when admins edit concurrently.

The append-only `event_admin_audit_log` records state-changing admin actions and the resulting event version. Draft creation inserts the event and `event.created` audit row in one transaction. Media intent appends `event.media_upload_requested`. Successful verification attaches or atomically replaces media, increments the event version, and appends `event.media_attached` or `event.media_replaced`. Explicit removal increments the version and appends `event.media_removed`. Publication atomically changes the status, records the publication time, increments the version, appends `event.published`, and inserts the versioned Kafka fact into the outbox. Each formerly accepted object receives durable deletion work in the same replacement or removal transaction. Mutation, audit, or outbox failure rolls back the complete state change.

Reads do not create durable audit rows. They remain visible through bounded request metrics, traces, and structured operational logs.

## Runtime

Event Service exposes gRPC for business traffic and HTTP for health. PostgreSQL is a real readiness dependency. One startup-owned RabbitMQ connection supplies purpose-specific publisher and consumer channels, and one startup-owned Kafka producer relays publication facts. Media dispatchers publish due PostgreSQL records and recover abandoned publication or execution leases. The publication relay uses expiring claims and bounded retry; PostgreSQL remains authoritative when Kafka is unavailable, and duplicate delivery remains possible. The idempotent verification worker checks exact object size, declared and detected image type, dimensions, and ETag before attachment or replacement. Missing objects retry until the ten-minute upload deadline. Transient R2 failures retry until the thirty-minute verification deadline. Rejected candidates and formerly accepted objects have separate durable deletion state. Both deletion paths are idempotent, stop after ten failures, and use no DLQ.

OpenTelemetry exports service identity, request and job metrics, business outcomes, traces, and structured logs without making the collector a readiness dependency.
