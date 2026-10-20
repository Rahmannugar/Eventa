# Architecture

The analytics domain is the Gateway's admin reporting surface. It holds no business logic: it authenticates through the admins module, meters reads, forwards three RPCs to the Analytics Service over gRPC, and translates results and failures into the Gateway's HTTP contract.

## Structure

- `AnalyticsModule.register()` wires one gRPC client (`ANALYTICS_GRPC_CLIENT`) to `ANALYTICS_GRPC_URL`, imports the admins module for the session guard and cookie, and provides the read rate-limit service and guard.
- `AdminAnalyticsController` exposes the three admin routes; each applies `AdminClientOriginGuard`, the analytics read rate limit, then `AdminAuthenticationGuard`.
- `AdminAnalyticsService` owns the deadline, the correlation header, response re-validation, and error translation. It never trusts a response whose shape does not match the request.
- `AdminAnalyticsRateLimitService` meters one read operation: an IP burst bucket plus IP and session hourly windows, keyed through the shared Redis-backed rate-limit state.

## Data flow

Request → admin session check → rate-limit decision → gRPC `ListEventPerformance`/`GetEventPerformance`/`GetPortfolioSummary` with a per-call deadline → response re-validation → DTO. The domain reads nothing directly: Analytics's projection and inbox live in the Analytics Service database, which this domain never touches.

## Dependencies

- `@eventa/grpc-contracts` for the analytics proto paths, package name, and client types.
- The shared rate-limit state (Redis) and the admins module's session guard and cookie.
- The Analytics Service at `ANALYTICS_GRPC_URL`; when it is unreachable, requests fail fast as `503` after the deadline.
