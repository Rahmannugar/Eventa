# Identity Attendees Domain Architecture

## Ownership

The domain owns attendee credentials, verification, lifecycle state, and live sessions. Attendee and admin principals are separate namespaces.

## Account State

PostgreSQL owns `attendee_accounts`: canonical email and username, Argon2id password hash, active/suspended status, verification timestamp, deletion timestamp, and creation timestamp.

- Database constraints enforce canonical email and username uniqueness under concurrency.
- Deleted email and username values remain reserved by the unconditional uniqueness constraints.
- Verification lookups exclude deleted rows. Login reads lifecycle state so it can return the agreed deleted or suspended outcome after credential verification.
- Password hashing and verification stay behind security capabilities; plaintext passwords do not enter persistence.

## Registration and Verification

Registration validates and canonicalizes input, hashes the password, inserts the account, and schedules the first verification email. Named uniqueness violations become stable domain conflicts.

Verification protects email subjects and OTP values with purpose-separated HMACs before Redis access. Redis atomically owns replacement, five guesses, the 15-minute lifetime, exact confirmed replay, and the resend cooldown. PostgreSQL records the first successful verification timestamp idempotently. RabbitMQ carries expiring delivery work to Notification through the existing durable job contract.

## Password Recovery

Forgot-password reserves a protected-email Redis cooldown before PostgreSQL lookup, so account existence does not change admission behavior. Only a verified, active, non-deleted attendee receives delivery work. Identity stores a protected code digest with five guesses and a fixed 15-minute lifetime; publication failure removes the unusable code and its request cooldown while preserving the accepted client response.

The first valid reset claim binds Redis state to a purpose-separated HMAC of the email, code, and replacement password. Another replacement password cannot take over that claim. Identity hashes the replacement, revokes every live session, conditionally updates the still-eligible PostgreSQL account, and marks the claim complete without extending its lifetime. Exact completion replay returns success without repeating password or session mutations.

`AttendeeAuthJobPublisher` groups the cohesive attendee verification and password-reset delivery capabilities. Its RabbitMQ adapter owns queue-specific contracts and uses the process-long `RabbitMQClient`; application services do not depend on RabbitMQ.

## Login and Sessions

Login canonicalizes the email, loads the account, and verifies the supplied password. Unknown accounts still perform Argon2id verification against a fixed dummy hash so they share the same credential failure. After a correct password, deleted and suspended accounts receive their distinct lifecycle outcomes; an unverified active account receives verification-required.

After successful credential checks, the session service:

1. generates a 32-byte opaque token and independent session ID;
2. HMACs the token and attendee ID with separate purposes;
3. asks Redis to create the live session atomically;
4. returns the plaintext token once to the Gateway.

One Redis Lua command uses Redis time, removes expired entries, evicts the oldest entry when three sessions already exist, stores the new session, and fixes its expiry at seven days. Requests do not extend that expiry. A per-attendee sorted index supports bounded eviction and all-session revocation.

Redis is the live session authority, so authentication is one protected-key lookup rather than a cache hit followed by PostgreSQL. A miss, expiry, or revocation rejects the session. Redis unavailability fails closed. No plaintext token, email, or username is stored in session keys or fields.

The Gateway receives the raw token only across the internal login response and places it in the browser cookie. Public login responses contain only the attendee account details.

Session authentication returns only Redis-owned session context. Account retrieval then reads PostgreSQL and accepts only a verified, active, non-deleted attendee account. Logout removes exactly the presented Redis session; a repeated logout is idempotent.

## Account Deletion

Deletion verifies the current password before mutation. One Redis command installs a short per-attendee deletion barrier and revokes every session; session creation checks the same barrier, closing the concurrent login race. A PostgreSQL transaction then sets `deleted_at` and inserts one `attendee.deleted.v1` outbox event. Failure cancels the preparation barrier when possible; its five-minute TTL bounds crash recovery. After commit, the barrier is retained for seven days while PostgreSQL remains the permanent login authority.

The outbox relay claims records with leases and `SKIP LOCKED`, publishes them to `eventa.identity.attendee-lifecycle.v1` keyed by attendee ID, and records completion. Broker failure schedules bounded exponential retry without changing the successful deletion response. Event IDs support consumer deduplication under at-least-once delivery.

## Failure and Observability

Expected credential, verification, uniqueness, and unavailable-state outcomes receive deliberate gRPC translations. Unexpected failures remain internal.

Spans use bounded operation names for password, PostgreSQL, Redis, and messaging work. Logs, traces, and metrics never include passwords, OTPs, session tokens, token digests, email addresses, or usernames.
