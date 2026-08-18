# Events API

## Published events

`GET /events/:eventId` is public and returns the authoritative published representation: event content, schedule, venue, verified media, publication time, and version. It does not expose creator provenance or lifecycle state. Draft and missing IDs both return `404 EVENT_NOT_FOUND`, so the public boundary does not disclose draft existence.

The route uses an IP-only read budget. Event dependency or deadline failures return `503 EVENT_SERVICE_UNAVAILABLE`.

Authenticated attendees use `POST`, `GET`, and `DELETE /events/:eventId/ticket-types/:ticketTypeId/waitlist` to join, inspect, or leave one ticket-type waitlist. Join accepts a positive quantity no greater than the ticket type's total capacity and returns the waiting position or timed purchase eligibility. Exact repeats are idempotent. Join is rejected when the requested tickets are available and no queue exists, when sales are unavailable, or when the bounded waitlist is full. Gateway derives attendee identity from the server-backed session and applies separate read and mutation budgets by client IP and protected session.

## Admin management

All routes require the opaque `eventa_admin_session` cookie. A present browser `Origin` must match the configured Eventa web origin. Any authenticated admin may manage any event.

| Method   | Path                                                | Outcome                                                                             |
| -------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET`    | `/admin/events`                                     | Lists events with bounded search, venue filters, sorting, and cursor pagination.    |
| `POST`   | `/admin/events`                                     | Creates a complete private event at version 1.                                      |
| `GET`    | `/admin/events/:eventId`                            | Returns the latest draft details, verified images, and version.                     |
| `PUT`    | `/admin/events/:eventId`                            | Saves complete draft details and returns the new version.                           |
| `DELETE` | `/admin/events/:eventId`                            | Recoverably removes a draft at the supplied version.                                |
| `POST`   | `/admin/events/:eventId/publish`                    | Publishes a complete draft at the supplied version.                                 |
| `POST`   | `/admin/events/:eventId/media-uploads`              | Starts a direct image upload for an empty slot or replacement.                      |
| `GET`    | `/admin/events/:eventId/media-uploads/:uploadId`    | Reports whether that upload is waiting, attached, rejected, conflicted, or expired. |
| `DELETE` | `/admin/events/:eventId/media/:slot`                | Clears the selected verified image and returns the new event version.               |
| `GET`    | `/admin/events/:eventId/ticket-types`               | Returns the event's ticket currencies, version, and ticket types.                   |
| `POST`   | `/admin/events/:eventId/ticket-currencies`          | Defines another ticket currency for a draft and returns the new event version.      |
| `POST`   | `/admin/events/:eventId/ticket-types`               | Adds a ticket type to a draft and returns the new event version.                    |
| `PUT`    | `/admin/events/:eventId/ticket-types/:ticketTypeId` | Updates a ticket type and returns the new event version.                            |
| `DELETE` | `/admin/events/:eventId/ticket-types/:ticketTypeId` | Retires an unused ticket type at the supplied event version.                        |

Create accepts a title, description, one to five case-insensitively unique categories, schedule, IANA timezone, and venue address. A venue may carry a structured state or region code alongside its display name. Update accepts the same details plus the expected version.

The list accepts a limit from one to 50, case-insensitive event-name search, an ISO country code, a dependent state or region code, and `updated_desc`, `event_date_asc`, or `event_date_desc` sorting. A state or region filter requires a country. Its opaque cursor is valid only with the search, filter, and sort criteria that produced it.

## Media uploads

An upload request selects `cover` or one of four gallery slots and declares a JPEG, PNG, or WebP file up to 8 MiB. The response gives the browser a create-only R2 upload URL, the exact required headers, a ten-minute upload deadline, and a thirty-minute verification deadline. The browser uploads directly to R2 and polls the returned upload ID; it never sends a confirmation command.

If the slot already has an image, the request starts a replacement. The accepted image remains visible until the new file passes verification and replaces it atomically. A failed replacement leaves the accepted image unchanged.

Upload status tells the client what to do:

| Status     | Client meaning                                                                |
| ---------- | ----------------------------------------------------------------------------- |
| `pending`  | Upload or verification is still in progress. Keep the local preview and poll. |
| `attached` | The image is accepted. Reload the event at `attachedEventVersion`.            |
| `rejected` | The uploaded bytes failed verification or verification could not finish.      |
| `conflict` | The event changed after the upload began. Reload before trying again.         |
| `expired`  | No object arrived before the ten-minute upload deadline.                      |

Removal takes `expectedVersion` as a query parameter. It immediately removes the verified reference and returns the new event version; physical object deletion continues as recoverable background work.

Publication requires complete details, one venue, a verified cover image, and at least one ticket type. It takes `expectedVersion`, returns the published event with its incremented version and publication time, and freezes draft mutations. An incomplete event returns `422 EVENT_PUBLICATION_INCOMPLETE`; a stale version or an already-published event returns `409 EVENT_VERSION_CONFLICT`.

Draft removal takes `expectedVersion` as a query parameter and returns the resulting event version. Repeating a completed removal succeeds with the same version. Retired drafts disappear from lists and direct reads. Published events return `422 EVENT_RETIREMENT_NOT_ALLOWED`.

Currency definition takes `expectedVersion` and an ISO 4217 currency. An event may define several currencies but cannot define the same currency twice. Ticket-type creation takes `expectedVersion`, an event-owned `ticketCurrencyId`, name, optional description, integer price in minor units, capacity, and ISO-8601 sales bounds. Event Service accepts no more than 20 active types across the event, requires sales to end no later than the event start, and owns all mutation invariants. Updates use the same fields except the immutable currency parent. Price and sales bounds stop changing after a reservation or sale; capacity cannot fall below reserved plus sold or below an active waitlist request. Retirement requires no reserved or sold quantity, and published events retain at least one active type. Invalid parents, duplicate names within a currency, duplicate currencies, windows, and fields return `422`; stale event state returns `409 EVENT_VERSION_CONFLICT`. Reads use the ordinary event-read budget. Ticket mutations use the separate ticket-catalogue budget by session and client IP.

Missing events return `404 EVENT_NOT_FOUND`; missing uploads and empty removal slots return `404 EVENT_MEDIA_UPLOAD_NOT_FOUND` and `404 EVENT_MEDIA_NOT_FOUND`. A stale mutation returns `409 EVENT_VERSION_CONFLICT`. A pending upload for the slot returns `409 EVENT_MEDIA_UPLOAD_IN_PROGRESS`. Invalid fields return `422 VALIDATION_FAILED`. Event dependency or deadline failures return `503 EVENT_SERVICE_UNAVAILABLE`. Create, update/media removal, draft removal, publication, media-intent, media-status polling, and ordinary read operations have separate budgets by protected session and client IP.
