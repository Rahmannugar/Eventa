# API Gateway Architecture

## Responsibility

The Gateway accepts public HTTP requests and translates them into explicit internal contracts. It owns client transport concerns but does not decide attendee uniqueness or persist attendee data.

## Source Boundaries

```text
src/domains/
  attendees/
    controllers, DTOs, docs, services
    rate-limit rules and attendee-specific subject extraction

src/rate-limit/
  Redis adapter, atomic hybrid engine, connection lifecycle, shared contracts
```

Domain code decides which subjects and numeric rules protect an endpoint. The shared rate-limit capability knows how to consume a supplied hybrid policy atomically but does not know that the secondary subject is an email. `AppModule` registers one Gateway-wide Redis client and exports the store capability globally; future domains inject that capability without creating their own clients. Their rules remain beside their endpoints, and Redis remains explicit at the concrete adapter leaf.

## Registration Execution

1. `AttendeeRegistrationRateLimitGuard` derives the trusted client IP and optional email subject before DTO validation.
2. `AttendeeRegistrationRateLimitService` canonicalizes and HMACs subjects, then supplies attendee registration rules to the shared store.
3. `RedisRateLimitAdapter` uses Redis server time and one Lua script to evaluate a token bucket, primary sliding window, and optional secondary sliding window atomically.
4. An admitted request reaches the global validation pipe and attendee controller.
5. `AttendeeRegistrationService` sends the typed `RegisterAttendee` gRPC command and the request ID to Identity and translates gRPC outcomes into stable client-facing HTTP responses.

## Failure Behavior

Registration fails closed with `503` when Redis cannot make the admission decision. This does not make Gateway liveness false because Redis is a route dependency rather than a dependency of every Gateway capability.

Malformed JSON becomes `400`. A known registration path called with the wrong HTTP method becomes `405`. Gateway DTO or Identity command validation becomes `422`, uniqueness conflicts become `409`, rate-limit denial becomes `429`, and unavailable dependencies become `503`. The shared HTTP filter keeps the response envelope stable and records a safe diagnostic code for request logs without exposing Redis, gRPC, or database details to clients.

## Configuration and Lifecycle

Gateway configuration is validated before the HTTP listener starts. Trusted-proxy hops are explicit. The Redis client connects lazily for the protected route, disables the offline queue and automatic reconnect loop, and closes during application shutdown.

The Gateway intentionally exposes only liveness because it has no database or universal local dependency that would make every route unready.

## Observability Boundary

OpenTelemetry starts through Node's `--require` hook before NestJS and instrumented libraries load. Automatic HTTP and gRPC instrumentation propagates trace context into Identity. Gateway HTTP middleware validates and preserves an incoming `x-request-id` or creates one, records one bounded request count and duration, and emits one structured completion log carrying request ID, trace ID, status, and safe error reason. The gRPC call forwards the same request ID as metadata. Successful health probes are excluded from these signals.

Framework middleware/controller auto-spans are disabled because their inclusive timing obscured the real work. The trace keeps the HTTP and gRPC transport spans and adds a concrete `rate_limit.consume` client span around Redis admission.

The middleware owns transport telemetry; attendee controllers, guards, and application services do not call telemetry APIs. Rate-limit outcomes remain observable through the final HTTP status and request metric without coupling the reusable rate-limit capability to the monitoring implementation.
