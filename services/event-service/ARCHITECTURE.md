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

The `events` table is authoritative event state. The append-only `event_admin_audit_log` records state-changing admin actions. Draft creation inserts the event and `event.created` audit row in one transaction. A failed audit insert rolls back the event.

Reads do not create durable audit rows. They remain visible through bounded request metrics, traces, and structured operational logs.

## Runtime

Event Service exposes gRPC for business traffic and HTTP for health. PostgreSQL is a real readiness dependency. OpenTelemetry exports service identity, request metrics, business outcomes, traces, and structured logs without making the collector a readiness dependency.
