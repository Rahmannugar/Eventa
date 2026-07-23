# Identity Attendees Domain Architecture

## Ownership

The attendees domain owns attendee principals, credentials, and email-verification state. Admin identities remain a separate Identity domain, allowing the same human email to identify independent attendee and admin principals.

## Registration Flow

1. The gRPC controller receives `RegisterAttendee`; Identity's global pipe validates it independently of the Gateway.
2. The controller invokes the injected `AttendeeRegistrar` capability with validated input.
3. `ObservedAttendeeRegistrar` wraps the core application service and records the authoritative outcome.
4. `AttendeeRegistrationService.register()` canonicalizes email and username and asks the `PasswordHasher` capability for an Argon2id hash.
5. `PostgresAttendeeAccountRepository` receives canonical fields and the hash through `AttendeeAccountRepository`.
6. One PostgreSQL insert creates the account and returns its public registration projection.
7. `AttendeeRegistrationEmailVerificationService` creates the first OTP and asks `EmailVerificationJobPublisher` to place its expiring delivery job on RabbitMQ.
8. Named uniqueness violations become domain conflicts and then gRPC `ALREADY_EXISTS`.

Registration is command-only and does not use a generic command bus.

## State and Invariants

The domain owns `attendee_accounts`: `id`, canonical `email`, canonical `username`, `password_hash`, nullable `email_verified_at`, and `created_at`.

- PostgreSQL constraints are the final authority for canonical email and username uniqueness under concurrency.
- The raw password never crosses the password-hashing boundary.
- Argon2id uses 64 MiB memory, three iterations, and parallelism four.
- Registration leaves `email_verified_at` null.
- There is no separate attendee profile because no current behavior requires one.

## Internal Email-Verification OTP Lifecycle

`AttendeeEmailVerificationService` creates cryptographically random six-digit OTPs and returns the plaintext value only to its in-process caller. It protects both the canonical email subject and OTP with purpose-separated HMAC-SHA256 values before calling `EmailVerificationOtpState`; Redis keys, stored fields, logs, and traces never contain the email or plaintext OTP.

Redis stores one OTP record per protected email subject for 15 minutes. Saving a replacement overwrites the previous OTP and resets its five-guess allowance. One Lua operation checks an OTP and atomically decrements incorrect guesses; the fifth incorrect guess removes the OTP. A confirmed OTP keeps its confirmed state only for the original Redis lifetime so an exact retry returns the same success without extending validity.

Resend admission uses one atomic 60-second per-email cooldown before account lookup, including unknown and already-verified emails. There is no separate hourly product cap inside Identity.

`PostgresAttendeeAccountRepository.markEmailVerified()` uses `COALESCE(email_verified_at, NOW())`, so repeated or concurrent confirmation preserves the first database timestamp. Redis confirmation is recorded after the database update; if that Redis call fails, retrying the same OTP repeats the idempotent database operation.

`EmailVerificationJobPublisher` creates a versioned job with a unique job ID and the same 15-minute expiry as the OTP. Its RabbitMQ adapter uses a persistent message, durable quorum queue, publisher confirmation, and OpenTelemetry propagation headers. `RabbitMQClient` owns the shared connection and the publisher's purpose-specific confirm channel.

## Failure and Observability

Expected uniqueness violations are translated deliberately; unexpected database failures remain internal gRPC failures. Once PostgreSQL creates the account, OTP scheduling failure is recorded safely but does not reinterpret that committed account as a failed registration. The observed-handler decorator records `created`, `email_conflict`, `username_conflict`, or `failed` after the core operation decides the outcome, preserving the original result or error. Transport logging and tracing remain service-level concerns.
