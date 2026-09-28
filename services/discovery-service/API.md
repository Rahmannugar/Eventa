# API

Discovery Service exposes operational HTTP health checks and one internal gRPC query. Business work enters as messages; only the search query arrives as a request, and it is reached through the API Gateway.

## Endpoints

### `GET /health/live`

Process liveness. Always `200 {"status":"ok"}`; it checks no dependency.

### `GET /health/ready`

Instance readiness. Returns `200 {"status":"ready"}` when every readiness dependency responds, otherwise:

```json
{
  "statusCode": 503,
  "message": "dependency unavailable",
  "error": "Service Unavailable"
}
```

Readiness aggregates only the dependency this process holds as shared state: a ping on its own database pool. The lifecycle consumer rejoins its group and retries through its own backoff when the broker is unreachable, and Event Service is dialled per call with an explicit deadline, so neither is a reason to report an instance unready. Readiness never probes Kafka, Event Service, or the OTLP collector.

Any other method on either path returns `405`.

Every response carries `x-request-id`. An inbound `x-request-id` is echoed when it matches `[A-Za-z0-9._:-]{1,128}`; anything else is replaced with a generated UUID.

## Ports

- `HEALTH_PORT` (local default `3011`) — HTTP health.
- `GRPC_PORT` (local default `50054`) — the internal query API below.

## `DiscoveryService.SearchEvents`

One structured query over the Discovery-owned event projection. It is an internal service: the API Gateway holds the authenticated public route, and Discovery does not authenticate callers itself.

Request:

| Field | Type | Meaning |
| --- | --- | --- |
| `query` | string | Free-text words matched case-insensitively against title and description. `%` and `_` are literal. |
| `categories` | repeated string | Exact categories. A row matches when it carries any listed value, compared case-insensitively. |
| `starts_from`, `starts_to` | RFC 3339 string | Inclusive bounds on the event start time. |
| `limit` | int32 | Page size. `0` means 20; values above 50 are clamped. |
| `offset` | int32 | Page offset, at most 10000. |

Response: the matching `events`, plus `total`, `limit`, and `offset`. Results are ordered by start time, then event id, so pagination is stable.

Only rows the projection holds as `published` with content are returned. A cancelled event never appears, and neither does a published row whose content Event Service no longer serves.

Status codes: `INVALID_ARGUMENT` for a malformed request — a bad timestamp, a negative offset, or an unbalanced time range — and `INTERNAL` for a database failure. Neither log line nor error message contains the caller's query text.

## Not exposed

There is no public business endpoint on this service. Attendees reach search through `GET /search/events` on the API Gateway; recommendations arrive with a later slice.
