# Identity Service Architecture

## Ownership

Identity owns attendee and admin security principals, credentials, verification, and sessions. Each substantial identity domain owns its application flow, state rules, and concise API and architecture documentation.

The current implementation contains the Attendees domain only. Its registration command, state, invariants, and failure behavior are documented in [src/attendees/ARCHITECTURE.md](src/attendees/ARCHITECTURE.md).

## Service Composition

- `AppModule` composes runtime configuration, database lifecycle, health, security adapters, and business domains.
- Domain modules expose gRPC command/query controllers and depend on capability-oriented ports.
- The service composition root selects concrete persistence, security, and observability decorators.
- Business domains do not own process startup or cross-domain infrastructure client lifecycle.

## Database and Migrations

Drizzle schemas and migrations remain inside Identity and are organized by owning domain. The migration runner uses a dedicated one-connection process and always closes it. Runtime database connections are closed during graceful shutdown.

Migration `0001_move_username_to_attendee_accounts` forwards already-migrated databases by copying usernames from the former profile table before enforcing non-null uniqueness and dropping that table.

## Health and Failure

Liveness confirms the process is running. Readiness queries PostgreSQL because Identity cannot serve its current business capability without its database.

Unexpected infrastructure failures propagate as internal gRPC failures unless a domain deliberately defines a stable translation. Domain documents own those expected outcomes.

## Observability Boundary

OpenTelemetry starts through Node's `--require` hook before NestJS and instrumented libraries load. Automatic gRPC instrumentation continues the Gateway trace, while the global RPC interceptor records bounded request metrics and one structured completion log with the active trace ID and forwarded request ID.

The trace includes `password.hash` and `INSERT attendee_accounts` spans around the concrete Argon2 and PostgreSQL work. The database span contains only bounded semantic attributes such as system, operation, database, and table; it never records SQL values, credentials, email, username, or password. Manual database instrumentation is used because the current postgres.js driver is not covered by the installed PostgreSQL auto-instrumentation.

Authoritative business outcomes are recorded through domain-owned decorators around command/query capabilities. Nest module composition selects those decorators while controllers remain coupled only to application capability tokens. The Attendees domain documents its current outcome vocabulary.
