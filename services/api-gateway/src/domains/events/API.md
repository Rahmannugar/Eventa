# Admin Events API

All routes require the opaque `eventa_admin_session` cookie. A present browser `Origin` must match the configured Eventa web origin. Any authenticated admin may manage any event.

| Method | Path                     | Outcome                                                                  |
| ------ | ------------------------ | ------------------------------------------------------------------------ |
| `POST` | `/admin/events`          | Creates a title-only draft and returns the authoritative Event record.   |
| `GET`  | `/admin/events/:eventId` | Returns an Event record and version for admin management.                |
| `PUT`  | `/admin/events/:eventId` | Replaces editable draft details when the expected version is still live. |

Create accepts a trimmed title between one and 160 characters. Update accepts the expected version, title, description, category, schedule, IANA timezone, and venue address. Responses include the authoritative details and version.

Missing events return `404 EVENT_NOT_FOUND`. A stale update returns `409 EVENT_VERSION_CONFLICT`. Invalid fields return `422 VALIDATION_FAILED`. Event dependency or deadline failures return `503 EVENT_SERVICE_UNAVAILABLE`. Create, update, and read have separate budgets by protected session and client IP.
