# Identity Attendees Domain Architecture

## Ownership

The attendees domain owns attendee principals, credentials, email-verification state, and future attendee sessions. Admin identities remain a separate Identity domain, allowing the same human email to identify independent attendee and admin principals.

## Registration Flow

1. The gRPC controller receives `RegisterAttendee`; Identity's global pipe validates it independently of the Gateway.
2. The controller invokes the injected `AttendeeRegistrar` capability with validated input.
3. `ObservedAttendeeRegistrar` wraps the core application service and records the authoritative outcome.
4. `AttendeeRegistrationService.register()` canonicalizes email and username and asks the `PasswordHasher` capability for an Argon2id hash.
5. `PostgresAttendeeAccountRepository` receives canonical fields and the hash through `AttendeeAccountRepository`.
6. One PostgreSQL insert creates the account and returns its public registration projection.
7. Named uniqueness violations become domain conflicts and then gRPC `ALREADY_EXISTS`.

Registration is command-only. A query handler will be introduced when the domain gains an actual read use case; no generic command bus is used.

## State and Invariants

The domain owns `attendee_accounts`: `id`, canonical `email`, canonical `username`, `password_hash`, nullable `email_verified_at`, and `created_at`.

- PostgreSQL constraints are the final authority for canonical email and username uniqueness under concurrency.
- The raw password never crosses the password-hashing boundary.
- Argon2id uses 64 MiB memory, three iterations, and parallelism four.
- Registration leaves `email_verified_at` null.
- There is no separate attendee profile because no current behavior requires one.

Verification challenge issuance, delivery, and confirmation belong to this domain but remain unimplemented in the next slices of the current story.

## Failure and Observability

Expected uniqueness violations are translated deliberately; unexpected database failures remain internal gRPC failures. The observed-handler decorator records `created`, `email_conflict`, `username_conflict`, or `failed` after the core operation decides the outcome, preserving the original result or error. Transport logging and tracing remain service-level concerns.
