# API

Admin-scoped reporting routes. Every route requires the admin session cookie, an allowed admin client origin, and passes the analytics read rate limit; the Gateway calls Analytics over gRPC with `ANALYTICS_GRPC_DEADLINE_MS`.

## `GET /admin/analytics/events`

Lists one page of per-event performance ordered by event ID. Query: `limit` (1–100, default 25), `offset` (default 0), optional `status` (`published` or `cancelled`). Returns `events`, the exact `total` for the same filter, and the echoed `limit`/`offset`.

## `GET /admin/analytics/events/:eventId`

Returns one event's performance record. An event with no projected row answers `404 EVENT_PERFORMANCE_NOT_FOUND`.

## `GET /admin/analytics/summary`

Returns the portfolio roll-up: published and cancelled event counts, checked-in and revoked ticket totals, and revenue grouped per currency with gross, refunded, and net minor-unit amounts. Totals are never summed across currencies.

## Errors

Analytics's `INTERNAL` maps to `503 ANALYTICS_SERVICE_UNAVAILABLE`; `INVALID_ARGUMENT` maps to `400 ANALYTICS_QUERY_INVALID`; deadline expiry maps to `503` with a diagnostic code. Responses are re-read before they leave the Gateway: an answer whose shape does not match the request is reported as unavailable rather than returned.
