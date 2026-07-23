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

## Invariants and Failure Behavior

- Rate limiting fails closed with `503` when Redis cannot make an admission decision.
- Submitted rate-limit subjects are HMACed before becoming Redis keys.
- DTO validation and Identity validation remain independent trust boundaries.
- Malformed JSON maps to `400`, validation to `422`, uniqueness conflicts to `409`, denial to `429`, and unavailable dependencies to `503`.
- Identity deadline expiry cancels the Gateway's gRPC call, returns the same safe `503` contract, and retains a deadline-specific internal diagnostic for logs and traces.
- Unsupported methods use the Gateway's ordinary unmatched-route behavior; there is no overlapping method catch-all.

## Dependencies and Observability

The domain consumes Gateway-wide `RateLimitState` and the Identity gRPC client. It owns neither client lifecycle. The Gateway's HTTP middleware and automatic HTTP/gRPC instrumentation record transport signals, so controllers and application services do not call telemetry APIs.
