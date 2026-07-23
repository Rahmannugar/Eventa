# API Gateway Architecture

## Responsibility

The Gateway accepts public HTTP requests and translates them into explicit internal contracts. It owns client transport concerns but does not decide attendee uniqueness or persist attendee data.

## Service Composition

```text
src/domains/
  attendees/
    attendee-owned transport, application, policy, and documentation

src/rate-limit/
  atomic hybrid policy state and shared contracts

src/infrastructure/clients/
  Redis connection lifecycle
```

Domain code decides which subjects and numeric rules protect an endpoint. The shared `RateLimitState` capability consumes supplied hybrid policies but knows nothing about attendee fields. `RedisClient` owns one Gateway-wide connection lifecycle; the Redis adapter owns the atomic rate-limit Lua operation. Domains depend on `RateLimitState`, not Redis.

The implemented attendee flow is documented in the domain-owned [ARCHITECTURE.md](src/domains/attendees/ARCHITECTURE.md).

## Failure Behavior

Protected routes fail closed with `503` when Redis cannot make an admission decision. This does not make Gateway liveness false because Redis is a route dependency rather than a dependency of every Gateway capability.

The shared HTTP filter keeps the public envelope stable and records a safe diagnostic code without exposing Redis, gRPC, or database details. Domain-owned API and architecture documents define their deliberate failure translations. Dependency timeouts are operational failures, not client errors. Unsupported methods fall through to the normal unmatched-route response rather than relying on overlapping catch-all routes.

## Configuration and Lifecycle

Gateway configuration is validated before the HTTP listener starts. Trusted-proxy hops are explicit. Node's HTTP header and request-body reception limits protect the public listener from incomplete requests; the keep-alive timeout bounds idle connection reuse. These transport limits do not masquerade as handler-execution deadlines.

Each Identity gRPC command carries an explicit absolute deadline. Deadline expiry cancels the client call through grpc-js and maps to the stable public `503 REGISTRATION_UNAVAILABLE` response with an internal deadline-specific diagnostic. The Redis client connects lazily for the protected route, disables the offline queue and automatic reconnect loop, bounds connection establishment and each command, and closes during application shutdown.

The Gateway intentionally exposes only liveness because it has no database or universal local dependency that would make every route unready.

## Observability Boundary

OpenTelemetry starts through Node's `--require` hook before NestJS and instrumented libraries load. Automatic HTTP and gRPC instrumentation propagates trace context into Identity. Gateway HTTP middleware validates and preserves an incoming `x-request-id` or creates one, records one bounded request count and duration, and emits one structured completion log carrying request ID, trace ID, status, and safe error reason. The gRPC call forwards the same request ID as metadata. Successful health probes are excluded from these signals.

Framework middleware/controller auto-spans are disabled because their inclusive timing obscured the real work. The trace keeps the HTTP and gRPC transport spans and adds a concrete `rate_limit.consume` client span around Redis admission.

The middleware owns transport telemetry; domain controllers, guards, and command/query handlers do not call telemetry APIs. Rate-limit outcomes remain observable through the final HTTP status and request metric without coupling the reusable capability to monitoring.
