# Gateway Attendees Domain Architecture

## Ownership

The Gateway attendees domain owns the public attendee transport boundary: request validation, abuse controls, gRPC translation, and stable HTTP error mapping. Identity owns attendee-account state and invariants.

## Registration Flow

1. `AttendeeRegistrationRateLimitGuard` derives the trusted client IP and optional email subject before DTO validation.
2. `AttendeeRegistrationRateLimitService` canonicalizes and HMACs subjects, then supplies the registration policy to the shared rate-limit capability.
3. The shared Redis adapter atomically evaluates the token bucket and sliding windows.
4. An admitted request passes the global validation pipe and reaches `AttendeeRegistrationController`.
5. The controller passes the validated input to `AttendeeRegistrationService.register()`.
6. The service forwards the typed gRPC request, request ID, and absolute deadline to Identity and maps the outcome to the public HTTP contract.

## Email-Verification Flow

1. Confirm and resend guards apply separate Redis-backed policies by client IP and protected canonical email.
2. DTOs validate the public email and six-digit OTP shapes.
3. `AttendeeEmailVerificationController` passes validated input and request correlation to its application service.
4. The service calls the matching Identity RPC with an absolute deadline.
5. Confirmation collapses all unusable OTP states into one public error. Resend preserves the same accepted response for unknown, verified, and unverified accounts.
6. Identity cooldown metadata becomes the public `Retry-After` header without exposing account state.

## Login Flow

1. The login guard applies the route's client-IP and protected canonical-email limits.
2. The DTO validates email and password independently of Identity.
3. The login service forwards the credentials, request ID, and absolute gRPC deadline.
4. Identity returns the attendee account details, opaque token, and absolute expiry after credential and session-state checks.
5. The controller sets the host-only HttpOnly session cookie and omits the token from the JSON response.

## Password-Recovery Flow

1. Forgot-password and reset-password guards enforce independent client-IP and protected canonical-email policies.
2. The exact attendee-client origin is required before either credential-changing request reaches Identity.
3. Forgot-password returns one accepted shape regardless of account existence or lifecycle eligibility.
4. Reset-password forwards the email, six-digit code, and validated replacement password through a bounded gRPC call.
5. Identity maps every unusable reset state to one public invalid-code response and reports dependency failure without exposing infrastructure details.

## Authenticated Session Flow

1. The account endpoint applies its client-IP and protected-session limits.
2. The authentication guard reads the single valid attendee cookie and asks Identity to resolve it from Redis.
3. The guard attaches only attendee ID, session ID, and absolute expiry to request context.
4. The account handler asks Identity for the verified active attendee account.
5. Logout validates the exact attendee-client origin, applies its own abuse policy, revokes the presented Redis session, and only then clears the cookie.

## Invariants and Failure Behavior

- Rate limiting fails closed with `503` when Redis cannot make an admission decision.
- Submitted rate-limit subjects are HMACed before becoming Redis keys.
- DTO validation and Identity validation remain independent trust boundaries.
- Malformed JSON maps to `400`, validation to `422`, uniqueness conflicts to `409`, denial to `429`, and unavailable dependencies to `503`.
- Identity deadline expiry cancels the Gateway's gRPC call, returns the same safe `503` contract, and retains a deadline-specific internal diagnostic for logs and traces.
- Confirm and resend quotas use separate keys, so one operation cannot consume the other's allowance.
- Forgot-password and reset-password quotas use separate keys from registration, verification, login, account retrieval, and logout.
- Login has independent keys and stable `401`, `403`, `422`, `429`, and `503` translations.
- Account retrieval and logout use separate rate-limit keys and quotas. Session subjects are HMAC-protected before entering Gateway Redis keys.
- Credentialed CORS names one configured attendee-client origin. Login, logout, forgot-password, and reset-password require that same exact `Origin`; cookie attributes remain host-only, HttpOnly, `SameSite=Lax`, and `Secure` on HTTPS.
- Logout without usable cookie state is idempotent. A revocation dependency failure keeps the cookie so the client can retry.
- Gateway rate-limit subjects and Identity OTP subjects are independently HMAC-protected before Redis storage.
- Unsupported methods use the Gateway's ordinary unmatched-route behavior; there is no overlapping method catch-all.

## Dependencies and Observability

The domain consumes Gateway-wide `RateLimitState` and the Identity gRPC client. It owns neither client lifecycle. The Gateway's HTTP middleware and automatic HTTP/gRPC instrumentation record transport signals, so controllers and application services do not call telemetry APIs.
