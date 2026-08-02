# Admin Events API

All routes require the opaque `eventa_admin_session` cookie. A present browser `Origin` must match the configured Eventa web origin. Any authenticated admin may manage any event.

| Method | Path                                             | Outcome                                                                  |
| ------ | ------------------------------------------------ | ------------------------------------------------------------------------ |
| `POST` | `/admin/events`                                  | Creates a title-only draft and returns the authoritative Event record.   |
| `GET`  | `/admin/events/:eventId`                         | Returns an Event record, verified media, and version.                    |
| `PUT`  | `/admin/events/:eventId`                         | Replaces editable draft details when the expected version is still live. |
| `POST` | `/admin/events/:eventId/media-uploads`           | Reserves an empty slot and returns a presigned R2 upload.                |
| `GET`  | `/admin/events/:eventId/media-uploads/:uploadId` | Returns durable worker verification status without changing it.          |

Create accepts a trimmed title between one and 160 characters. Update accepts the expected version, title, description, category, schedule, IANA timezone, and venue address. Media upload intent accepts the expected version, `cover` or one of four fixed gallery slots, JPEG, PNG, or WebP content type, and a byte size up to 8 MiB per file. Its response includes the upload ID, ten-minute upload expiry, thirty-minute verification deadline, presigned URL, and required headers. The browser sends those bytes directly to R2 and polls upload status; it never confirms the upload.

Missing events return `404 EVENT_NOT_FOUND`; a missing upload returns `404 EVENT_MEDIA_UPLOAD_NOT_FOUND`. A stale mutation returns `409 EVENT_VERSION_CONFLICT`. Occupied and pending slots return stable `409` errors. Invalid fields return `422 VALIDATION_FAILED`. Event dependency or deadline failures return `503 EVENT_SERVICE_UNAVAILABLE`. Create, update, media-intent, and read operations have separate budgets by protected session and client IP.
