# Discovery API

## Search

`GET /search/events` requires an attendee session and returns matching events from the Discovery projection. It never exposes a draft, a cancelled event, or an event whose content Event Service no longer serves.

| Parameter | Meaning |
| --- | --- |
| `query` | Free-text words matched against title and description. |
| `categories[]` | One or more exact categories, compared case-insensitively. |
| `startsFrom`, `startsTo` | Inclusive RFC 3339 bounds on the event start time. |
| `limit` | Page size, 1 to 50. Defaults to 20. |
| `offset` | Page offset, at most 10000. Defaults to 0. |

Each result carries the event id, title, description, start and end times, IANA timezone, categories, and venue name, city, and country code. Results are ordered by start time, then event id.

Responses are cached by the client only through their normal HTTP lifetime; Gateway holds no search cache.

### Errors

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `SEARCH_QUERY_INVALID` | The Discovery query could not be understood — a malformed timestamp or an unbalanced time range. |
| `422` | `VALIDATION_FAILED` | The request itself is malformed: an unknown parameter, an out-of-range `limit` or `offset`, or a non-RFC 3339 timestamp. |
| `503` | `DISCOVERY_SERVICE_UNAVAILABLE` | Discovery is unreachable, rejected the call, or returned a result Gateway could not render. |
| `503` | `DISCOVERY_SEARCH_RPC_DEADLINE_EXCEEDED` | The Discovery call missed its deadline. |

Failures carry no dependency detail beyond what a client can act on.

### Abuse controls

Search is an attendee read. It is limited by client IP burst and hourly budget and by a separate hourly budget per protected session, so one attendee cannot drain another's allowance. Exceeding a budget returns `429 EVENT_SEARCH_RATE_LIMITED`; an unavailable Discovery returns `503` rather than disclosing quota exhaustion.

## Interests

`GET /attendees/me/interests` and `PUT /attendees/me/interests` require an attendee session and act on the signed-in attendee only. The attendee id always comes from the session, never from the request.

`PUT` takes a body of up to 50 interests, each 1 to 64 characters, and replaces the stored list rather than appending to it:

```json
{ "interests": ["music", "jazz", "workshops"] }
```

Both routes answer with the stored shape:

```json
{ "interests": ["music", "jazz"], "updatedAt": "2026-09-29T00:05:33Z" }
```

An attendee who has never saved interests reads an empty list with no `updatedAt`.

### Errors

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `INTERESTS_INVALID` | The interest list was out of bounds or malformed for Discovery. |
| `422` | `VALIDATION_FAILED` | The body itself is malformed: more than 50 entries, a non-string entry, or an empty or overlong interest. |
| `429` | `INTERESTS_READ_RATE_LIMITED`, `INTERESTS_WRITE_RATE_LIMITED` | The attendee or client IP is over its budget. |
| `503` | `DISCOVERY_SERVICE_UNAVAILABLE` | Discovery is unreachable, rejected the call, or returned interests for a different attendee. |

### Abuse controls

Interest reads are limited by IP burst and hourly budgets, and interest writes by a separate, smaller budget because a write rewrites the stored record. Each route limits the client IP and the protected session independently, so one attendee cannot spend another's allowance.

## Recommendations

`GET /attendees/me/recommendations` requires an attendee session and returns events ranked for the signed-in attendee. The attendee id always comes from the session, never from the request.

| Parameter | Meaning |
| --- | --- |
| `limit` | Page size, 1 to 20. Defaults to 10. |

Each result carries the same fields as a search result — event id, title, description, start and end times, IANA timezone, categories, and venue name, city, and country code — ordered best match first. An attendee who has saved no interests gets an empty list.

### Errors

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `RECOMMENDATIONS_INVALID` | Discovery could not understand the request. |
| `422` | `VALIDATION_FAILED` | The request itself is malformed: an unknown parameter or a `limit` outside 1 to 20. |
| `429` | `RECOMMENDATIONS_RATE_LIMITED` | The attendee or client IP is over its budget. |
| `503` | `DISCOVERY_SERVICE_UNAVAILABLE` | Discovery is unreachable, rejected the call, or returned an answer for a different attendee. |
| `503` | `DISCOVERY_RECOMMENDATIONS_RPC_DEADLINE_EXCEEDED` | The Discovery call missed its deadline. |

Failures carry no dependency detail beyond what a client can act on.

### Abuse controls

A recommendation costs an embed, a similarity search, and a resolution call, so it is metered more tightly than a search: an IP burst budget plus hourly budgets for the client IP and the protected session, each independent, so one attendee cannot drain another's allowance. Exceeding a budget returns `429`; an unavailable Discovery returns `503` rather than disclosing quota exhaustion.

## Similar events

`GET /events/:eventId/similar` is public, like the event detail it sits beside, and returns events similar to the named one. The path id must be a UUID.

| Parameter | Meaning |
| --- | --- |
| `limit` | Page size, 1 to 20. Defaults to 10. |

Each result carries the same fields as a search result, ordered best match first. The event asked about is never returned with itself, and only events Event Service still serves appear.

### Errors

| Status | Code | Meaning |
| --- | --- | --- |
| `400` | `SIMILAR_EVENTS_INVALID` | Discovery could not understand the request. |
| `404` | `EVENT_NOT_FOUND` | Discovery holds no published event with that id. |
| `422` | `VALIDATION_FAILED` | The request itself is malformed: a path id that is not a UUID, an unknown parameter, or a `limit` outside 1 to 20. |
| `429` | `SIMILAR_EVENTS_RATE_LIMITED` | The client IP or the attendee session is over its budget. |
| `503` | `DISCOVERY_SERVICE_UNAVAILABLE` | Discovery is unreachable, rejected the call, or returned an answer for a different event. |
| `503` | `DISCOVERY_SIMILAR_RPC_DEADLINE_EXCEEDED` | The Discovery call missed its deadline. |

Failures carry no dependency detail beyond what a client can act on.

### Abuse controls

A similar-events answer costs an embed, a similarity search, and a resolution call, so it is metered like a recommendation: an IP burst budget plus hourly budgets for the client IP and for the attendee session when one is present, each independent. Exceeding a budget returns `429`; an unavailable Discovery returns `503` rather than disclosing quota exhaustion.
