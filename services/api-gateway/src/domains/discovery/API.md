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
