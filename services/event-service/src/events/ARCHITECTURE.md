# Events Architecture

## State

An event begins in `draft` at version 1. Creation requires only a normalized title. A full draft update supplies the description, category, schedule, IANA timezone, and one event-owned venue address. Publication rules remain outside this slice.

## Draft Creation

1. The controller receives the authenticated admin ID, title, and propagated request ID.
2. The application service normalizes the title.
3. The repository opens one PostgreSQL transaction.
4. It inserts the draft event.
5. It appends `event.created` with the acting admin, event, request ID, and occurrence time.
6. Both rows commit before the response is returned.

## Draft Editing

1. The client sends the version from its latest event representation. Gateway derives the acting admin ID from the authenticated server-backed session and attaches both values to the internal command.
2. PostgreSQL updates the draft only when its ID, `draft` status, and version match, then increments the version.
3. The same transaction upserts the event venue and appends `event.updated` with the resulting version.
4. A competing update with the stale version changes nothing and returns a version conflict.

## Admin Access

Admin identity authorizes the management surface, not ownership of an individual event. We retain `created_by_admin_id` for provenance. We do not filter reads or mutations by creator.

## Verified Media Upload

1. The client requests an upload for an empty fixed slot using the event version it read.
2. Event Service locks the event row, verifies draft state and version, inserts a durable pending upload, and appends `event.media_upload_requested` in one transaction.
3. Event Service returns a create-only presigned R2 `PUT`. The browser uploads directly with the signed content type and `If-None-Match: *` headers. There is no confirmation endpoint.
4. A dispatcher publishes the upload ID through RabbitMQ. The worker may run before the browser completes, so an absent object releases its database claim and retries with bounded backoff until the upload deadline.
5. The worker verifies the stored byte count, declared metadata, detected JPEG, PNG, or WebP content, dimensions, and ETag. A present object is inspected even when the worker wakes at the deadline.
6. Attaching locks the upload, compares the event's stored expected version, inserts `event_media`, increments the event version, and appends `event.media_attached` in one transaction. Duplicate deliveries cannot attach or audit twice.
7. Invalid, expired, or version-conflicted uploads remain durable terminal records. The same worker removes their objects with at most ten idempotent deletion attempts.

PostgreSQL is authoritative for scheduling and execution state. RabbitMQ carries retryable assignments containing only the upload ID. Publication failure leaves the record dispatchable; duplicate publication is safe.

## Audit

The audit table is append-only through the Event application boundary. It records only mutations, including the resulting event version. Reads use ordinary request telemetry and do not grow durable audit history.
