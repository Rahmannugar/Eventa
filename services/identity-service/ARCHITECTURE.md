# Identity Service Architecture

## Ownership

Identity owns attendee and admin security principals, credentials, verification state, account lifecycle, and sessions. Each implemented identity domain owns its application flow, state rules, and concise API and architecture documentation.

Identity contains separate Admins and Attendees domains. Their behavior is documented in [src/admins/ARCHITECTURE.md](src/admins/ARCHITECTURE.md) and [src/attendees/ARCHITECTURE.md](src/attendees/ARCHITECTURE.md).

## Service Composition

- `AppModule` composes runtime configuration, database lifecycle, health, security adapters, and business domains.
- Domain modules expose gRPC command/query controllers and depend on capability-oriented ports.
- The service composition root selects concrete persistence, security, and observability decorators.
- Business domains do not own process startup or cross-domain infrastructure client lifecycle.
- `RedisClient` owns Identity's Redis connection; `RabbitMQClient` owns its RabbitMQ connection and purpose-specific confirm channels. Both are process singletons closed during graceful shutdown.

## Database and Migrations

Drizzle schemas and migrations remain inside Identity and are organized by owning domain. The migration runner uses a dedicated one-connection process and always closes it. Runtime database connections are closed during graceful shutdown.

Migration `0001_move_username_to_attendee_accounts` forwards already-migrated databases by copying usernames from the former profile table before enforcing non-null uniqueness and dropping that table.

Migration `0002_add_attendee_account_lifecycle` adds active/suspended status and the permanent soft-deletion timestamp. Live sessions remain Identity-owned Redis state.

Migration `0004_create_admin_accounts` adds the separate inherently-admin account model. Reviewed operator SQL provisions inactive canonical emails; public activation cannot create rows.

## Health and Failure

Liveness confirms the process is running. Readiness queries PostgreSQL because credential operations depend on it. Login and session authentication fail closed when Redis cannot read or change live session state.

Unexpected infrastructure failures propagate as internal gRPC failures unless a domain deliberately defines a stable translation. Domain documents own those expected outcomes.

## Observability Boundary

OpenTelemetry starts through Node's `--require` hook before NestJS and instrumented libraries load. Automatic gRPC instrumentation continues the Gateway trace, while the global RPC interceptor records bounded request metrics and one structured completion log with the active trace ID and forwarded request ID.

The trace includes `password.hash` and `INSERT attendee_accounts` spans around the concrete Argon2 and PostgreSQL work. The database span contains only bounded semantic attributes such as system, operation, database, and table; it never records SQL values, credentials, email, username, or password. Manual database instrumentation is used because the current postgres.js driver is not covered by the installed PostgreSQL auto-instrumentation.

Authoritative business outcomes are recorded through domain-owned decorators around command/query capabilities. Nest module composition selects those decorators while controllers remain coupled only to application capability tokens. The Attendees domain documents its current outcome vocabulary.
