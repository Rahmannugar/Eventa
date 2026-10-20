# API

Analytics exposes health endpoints over HTTP and its reporting API over gRPC. The API Gateway calls the gRPC API with a server-side deadline; nothing here is reachable directly from a browser.

## Endpoints

### `GET /health/live`

Returns `200 OK` while the process is running. Liveness never depends on a remote system.

### `GET /health/ready`

Returns `200 OK` when the PostgreSQL pool answers a ping, and `503 Service Unavailable` otherwise. A failed Kafka broker does not make the instance unready: the supervised consumers retry with bounded backoff and rejoin when the broker returns.

## Ports

| Purpose | Variable | Default |
| --- | --- | --- |
| Health HTTP | `HEALTH_PORT` | `3009` |
| gRPC | `GRPC_PORT` | `50055` |

## `AnalyticsService.ListEventPerformance`

Lists one page of per-event performance rows ordered by event ID. `limit` defaults to 25 and is clamped to 1–100; `offset` starts at 0; `status` filters to `published` or `cancelled` when set. The response carries the exact total for the same filter.

## `AnalyticsService.GetEventPerformance`

Returns one event's row. A well-formed event ID with no projected row returns `NOT_FOUND`; a malformed ID returns `INVALID_ARGUMENT`.

## `AnalyticsService.GetPortfolioSummary`

Returns the portfolio roll-up: published and cancelled event counts, checked-in and revoked ticket totals, and revenue grouped per currency. Net revenue is derived as gross minus refunded inside each currency; totals are never summed across different currencies.

## Not exposed

The durable inbox, the projection tables, and the Kafka consumer groups are internal. The API Gateway is the only intended caller of the gRPC API.
