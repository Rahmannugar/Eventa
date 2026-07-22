# Gateway Attendees Domain Architecture

## Ownership

The Gateway attendees domain owns the public attendee transport boundary: request validation, registration-specific abuse controls, CQRS command construction, gRPC translation, and stable HTTP error mapping. Identity owns attendee-account state and invariants.

## Registration Command Flow

1. `AttendeeRegistrationRateLimitGuard` derives the trusted client IP and optional email subject before DTO validation.
2. `AttendeeRegistrationRateLimitService` canonicalizes and HMACs subjects, then supplies the registration policy to the shared rate-limit capability.
3. The shared Redis adapter atomically evaluates the token bucket and sliding windows.
4. An admitted request passes the global validation pipe and reaches `AttendeeRegistrationController`.
5. The controller creates `RegisterAttendeeCommand`.
6. `RegisterAttendeeCommandHandler.handle()` forwards the typed gRPC command and request ID to Identity and maps the outcome to the public HTTP contract.

Registration is currently command-only. A query handler will be added only for a real read use case; this domain does not use a generic command bus.

## Invariants and Failure Behavior

- Rate limiting fails closed with `503` when Redis cannot make an admission decision.
- Submitted rate-limit subjects are HMACed before becoming Redis keys.
- DTO validation and Identity validation remain independent trust boundaries.
- Malformed JSON maps to `400`, validation to `422`, uniqueness conflicts to `409`, denial to `429`, and unavailable dependencies to `503`.
- Unsupported methods use the Gateway's ordinary unmatched-route behavior; there is no overlapping method catch-all.

## Dependencies and Observability

The domain consumes the Gateway-wide rate-limit store and Identity gRPC client. It owns neither client lifecycle. The Gateway's HTTP middleware and automatic HTTP/gRPC instrumentation record transport signals, so controllers and command handlers do not call telemetry APIs.
