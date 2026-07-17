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
5. `AttendeeRegistrationService` sends the typed `RegisterAttendee` gRPC command to Identity and translates gRPC outcomes into stable HTTP responses.

## Failure Behavior

Registration fails closed with `503` when Redis cannot make the admission decision. This does not make Gateway liveness false because Redis is a route dependency rather than a dependency of every Gateway capability.

Identity validation errors become HTTP `400`, canonical uniqueness conflicts become `409`, and unavailable or unexpected Identity failures become `503`.

## Configuration and Lifecycle

Gateway configuration is validated before the HTTP listener starts. Trusted-proxy hops are explicit. The Redis client connects lazily for the protected route, disables the offline queue and automatic reconnect loop, and closes during application shutdown.

The Gateway intentionally exposes only liveness because it has no database or universal local dependency that would make every route unready.

## Observability Boundary

OpenTelemetry starts through Node's `--require` hook before NestJS and instrumented libraries load. Automatic HTTP and gRPC instrumentation propagates trace context into Identity. Gateway HTTP middleware adds or preserves `x-request-id`, records one bounded request count and duration, and emits one structured completion log carrying both request and trace IDs. Successful health probes are excluded from these signals.

The middleware owns transport telemetry; attendee controllers, guards, and application services do not call telemetry APIs. Rate-limit outcomes remain observable through the final HTTP status and request metric without coupling the reusable rate-limit capability to the monitoring implementation.
