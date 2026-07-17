# Identity Service Architecture

## Ownership

Identity owns attendee and admin security principals, credentials, verification, and sessions. The namespaces remain separate so one human email can independently identify an attendee and an admin without sharing credentials or lifecycle.

The current slice implements only attendee registration.

## Registration Execution

1. The gRPC controller receives `RegisterAttendee` and Identity's global pipe validates it independently of the Gateway.
2. `RegisterAttendeeService` canonicalizes email and username and asks the `PasswordHasher` capability to produce an Argon2id hash.
3. `AttendeeRegistrationRepository` receives only canonical fields and the password hash.
4. One PostgreSQL insert creates the attendee account and returns its public registration projection.
5. Named uniqueness violations are translated into Identity domain errors and then gRPC `ALREADY_EXISTS`.

## Persistence

Identity owns the `attendee_accounts` table:

```text
attendee_accounts
  id
  email
  username
  password_hash
  email_verified_at
  created_at
```

PostgreSQL enforces canonical lowercase email, canonical username syntax, unique email, and unique username. The database is the final authority under concurrent requests; the application does not rely on a check-before-insert race.

There is no attendee profile table because the current product has no separate profile behavior. Explicit event interests and behavior-derived preferences belong to Discovery rather than Identity.

## Security Boundary

Attendee code depends on the `PasswordHasher` capability. `Argon2PasswordHasher` is the concrete security adapter, and the raw password never crosses the repository boundary.

Registration creates an unverified account by leaving `email_verified_at` null. Verification challenge issuance and confirmation are intentionally deferred to the next slice.

## Database and Migrations

Drizzle schema and migrations remain inside Identity. The migration runner uses a dedicated one-connection process and always closes it. Runtime database connections are closed during graceful shutdown.

Migration `0001_move_username_to_attendee_accounts` forwards already-migrated databases by copying usernames from the former profile table before enforcing non-null uniqueness and dropping that table.

## Health and Failure

Liveness confirms the process is running. Readiness queries PostgreSQL because Identity cannot serve its current business capability without its database.

Unexpected database failures propagate as internal gRPC failures. Named email and username uniqueness violations are the only persistence failures deliberately exposed as stable domain conflicts.

## Observability Boundary

OpenTelemetry starts through Node's `--require` hook before NestJS and instrumented libraries load. Automatic gRPC instrumentation continues the Gateway trace, while the global RPC interceptor records bounded request metrics and one structured completion log with the active trace ID.

`ObservedAttendeeRegistrar` is a domain-owned decorator around the `AttendeeRegistrar` capability. It records the authoritative registration outcome only after the core registrar returns or throws, then preserves the exact result or error. This keeps telemetry out of the controller and `RegisterAttendeeService` while still distinguishing `created`, `email_conflict`, `username_conflict`, and unexpected `failed` outcomes. Nest module composition selects the observed decorator; callers remain coupled only to the registrar capability token.
