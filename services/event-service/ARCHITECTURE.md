# Event Service Architecture

## Responsibility

Event Service owns event state, event lifecycle rules, and durable audit history for admin event mutations. It owns its PostgreSQL database and never reads Identity data. The authenticated admin ID arrives through the Gateway's internal gRPC command.

Any authenticated admin may manage any event. `created_by_admin_id` records provenance and does not grant exclusive ownership.

## Modules

- `events` owns event commands, queries, persistence, audit records, and domain documentation.
- `database` owns the PostgreSQL client, Drizzle database, migrations, and shutdown.
- `health` exposes liveness and database-backed readiness.
- `config` validates permanent runtime configuration before listeners start.

Controllers translate gRPC. Application services own use-case behavior. Repositories own persistence. Operational observation wraps the application capability without coupling core event behavior to telemetry.

## Persistence and Audit

The `events` table is authoritative event state. `event_venues` stores one event-owned venue address. Title-only drafts have no venue until a full draft update supplies the content, category, schedule, timezone, and venue together.

Every event carries a monotonically increasing version. A draft update changes the event only when its expected version matches, increments the version, upserts the venue, and appends `event.updated` in one transaction. This prevents silent overwrites when admins edit concurrently.

The append-only `event_admin_audit_log` records state-changing admin actions and the resulting event version. Draft creation inserts the event and `event.created` audit row in one transaction. Mutation or audit failure rolls back the complete state change.

Reads do not create durable audit rows. They remain visible through bounded request metrics, traces, and structured operational logs.

## Runtime

Event Service exposes gRPC for business traffic and HTTP for health. PostgreSQL is a real readiness dependency. OpenTelemetry exports service identity, request metrics, business outcomes, traces, and structured logs without making the collector a readiness dependency.
