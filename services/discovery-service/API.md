# API

Discovery Service exposes operational HTTP health checks and four internal gRPC capabilities: event search, attendee interests, recommendations, and events similar to a named event. Business work enters as messages; these requests arrive from the API Gateway.

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

| Field                      | Type                                                       | Meaning                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `query`                    | string                                                     | Free-text words matched case-insensitively against title and description. `%` and `_` are literal.                                                                             |
| `categories`               | repeated string                                            | Exact categories. A row matches when it carries any listed value, compared case-insensitively.                                                                                 |
| `starts_from`, `starts_to` | RFC 3339 string                                            | Inclusive bounds on the event start time.                                                                                                                                      |
| `limit`                    | int32                                                      | Page size. `0` means 20; values above 50 are clamped.                                                                                                                          |
| `offset`                   | int32                                                      | Page offset, at most 10000.                                                                                                                                                    |
| `near`                     | message `NearClause`: `latitude`, `longitude`, `radius_km` | Optional proximity clause. Only venues within `radius_km` of the point are returned. Latitude must be −90..90, longitude −180..180, and the radius positive and at most 20000. |

Response: the matching `events`, plus `total`, `limit`, and `offset`. Without `near`, results are ordered by start time, then event id, so pagination is stable. With `near`, each result carries `distance_km` — the venue's distance from the requested point — and the page is ordered by that distance first, then start time. A venue without stored coordinates never matches a `near` clause; without one it is returned as any other event is.

Only rows the projection holds as `published` with content are returned. A cancelled event never appears, and neither does a published row whose content Event Service no longer serves.

Status codes: `INVALID_ARGUMENT` for a malformed request — a bad timestamp, a negative offset, an unbalanced time range, or a proximity clause outside these bounds — and `INTERNAL` for a database failure. Neither log line nor error message contains the caller's query text.

## `DiscoveryService.GetAttendeeInterests`

Reads the interests one attendee has saved. The attendee id arrives from the Gateway's authenticated session; Discovery resolves no account itself.

Request: `attendee_id`, a UUID.

Response: the same `attendee_id`, the stored `interests`, and `updated_at` as an RFC 3339 string. An attendee who has never saved interests gets an empty list with no `updated_at` — that is the cold-start position, not a failure.

Status codes: `INVALID_ARGUMENT` for an id that is not a UUID, `INTERNAL` for a database failure. Interest text is never logged; the log line carries the count.

## `DiscoveryService.SetAttendeeInterests`

Replaces one attendee's stored interests in a single write.

Request: `attendee_id` and up to 50 `interests`, each at most 64 characters after trimming. Empty entries are dropped and duplicates are removed case-insensitively, keeping the first spelling, so `Music` and `music` are one stored interest. An out-of-bounds request is rejected rather than shortened.

Response: the stored `attendee_id`, `interests`, and `updated_at`.

Status codes: `INVALID_ARGUMENT` for a bad attendee id or an out-of-bounds list, `INTERNAL` for a database failure. A rejected request writes nothing.

## `DiscoveryService.RecommendEvents`

Ranks published events for one attendee from the interests that attendee has saved and the behaviour Discovery has observed for them.

Request: `attendee_id`, a UUID; `limit`, the page size (`0` means 10 and values above 20 are rejected); and an optional `origin` — `latitude`/`longitude` in decimal degrees — the point the attendee is ranking from. Latitude must be −90..90 and longitude −180..180.

Response: the same `attendee_id` and the matching `events` in `EventSearchResult` shape, best match first. An attendee with neither saved interests nor behaviour evidence gets an empty list — that is the cold-start position, not a failure. An attendee with only behaviour evidence is served. When the request carried an origin, every returned event whose venue has coordinates also carries `distance_km` from that point.

Discovery reads the stored interests and the attendee's most recent evidence rows — up to 12 attended and 12 purchased, newest first — and renders them into one query text whose budget is split by evidence strength: what the attendee attended may fill the largest share, purchases the next, and saved interests the remainder, with unused share passed down that order. It asks the semantic store for a bounded multiple of the requested page. The store supplies the ranking; Event Service then decides which of those candidates it still serves, so a cancelled, retired, already-started, sold-out, or out-of-sale event never appears. Candidates Event Service drops are simply absent from the answer. Without an origin the remainder keeps the store's order; with one, distance joins that order as a bounded signal — a located venue gains ground as its distance shrinks, a venue with no coordinates competes on its store score alone, and the semantic ranking still leads.

Status codes: `INVALID_ARGUMENT` for a bad attendee id, an out-of-range limit, or an origin outside these bounds, `UNAVAILABLE` when the semantic store does not answer, `DEADLINE_EXCEEDED` when Event Service does not answer in time, and `INTERNAL` for a database failure. Interest and behaviour text is never logged; the log line carries counts.

## `DiscoveryService.SimilarEvents`

Ranks published events like one named event.

Request: `event_id`, a UUID, and `limit`, the page size. `0` means 10 and values above 20 are rejected.

Response: the same `event_id` and the matching `events` in `EventSearchResult` shape, best match first.

Discovery reads its own projection of the source event and renders the same text the indexer stored, so the query is embedded in the same vector space as the event's own entry. The source event is removed from the candidates before anything else happens, so an event never appears in the answer to its own question. Event Service then decides which of the remaining candidates it still serves, on the same authority recommendations use, so a cancelled, retired, already-started, or sold-out event never appears.

Status codes: `INVALID_ARGUMENT` for a bad event id or an out-of-range limit, `NOT_FOUND` when Discovery holds no published event with that id, `UNAVAILABLE` when the semantic store does not answer, `DEADLINE_EXCEEDED` when Event Service does not answer in time, and `INTERNAL` for a database failure. The log line carries counts only.

## Not exposed

There is no public business endpoint on this service. Attendees reach search through `GET /search/events`, their interests through `GET` and `PUT /attendees/me/interests`, and their recommendations through `GET /attendees/me/recommendations` on the API Gateway; events similar to one event come from `GET /events/:eventId/similar`.
