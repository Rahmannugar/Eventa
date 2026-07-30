# Admin Events API

Both routes require the opaque `eventa_admin_session` cookie. A present browser `Origin` must match the configured Eventa web origin. Any authenticated admin may manage any event.

| Method | Path                     | Outcome                                                                |
| ------ | ------------------------ | ---------------------------------------------------------------------- |
| `POST` | `/admin/events`          | Creates a title-only draft and returns the authoritative Event record. |
| `GET`  | `/admin/events/:eventId` | Returns an Event record for admin management.                          |

Create accepts a trimmed title between one and 160 characters. Responses contain the event ID, title, `draft` status, creator provenance, and timestamps.

Missing events return `404 EVENT_NOT_FOUND`. Invalid fields return `422 VALIDATION_FAILED`. Event dependency or deadline failures return `503 EVENT_SERVICE_UNAVAILABLE`. The routes have separate write and read budgets by protected session and client IP.
