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

## Invariants and Failure Behavior

- Rate limiting fails closed with `503` when Redis cannot make an admission decision.
- Submitted rate-limit subjects are HMACed before becoming Redis keys.
- DTO validation and Identity validation remain independent trust boundaries.
- Malformed JSON maps to `400`, validation to `422`, uniqueness conflicts to `409`, denial to `429`, and unavailable dependencies to `503`.
- Identity deadline expiry cancels the Gateway's gRPC call, returns the same safe `503` contract, and retains a deadline-specific internal diagnostic for logs and traces.
- Confirm and resend quotas use separate keys, so one operation cannot consume the other's allowance.
- Gateway rate-limit subjects and Identity OTP subjects are independently HMAC-protected before Redis storage.
- Unsupported methods use the Gateway's ordinary unmatched-route behavior; there is no overlapping method catch-all.

## Dependencies and Observability

The domain consumes Gateway-wide `RateLimitState` and the Identity gRPC client. It owns neither client lifecycle. The Gateway's HTTP middleware and automatic HTTP/gRPC instrumentation record transport signals, so controllers and application services do not call telemetry APIs.
