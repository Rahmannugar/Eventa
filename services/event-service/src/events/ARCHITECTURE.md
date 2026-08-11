# Events Architecture

## State

An event begins in `draft` at version 1. Creation requires only a normalized title. A full draft update supplies the description, category, schedule, IANA timezone, and one event-owned venue address. Publication requires those details, the venue, and one verified cover image. A published event has an immutable publication time and no longer accepts draft or media mutations.

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

## Published Access

The published-event repository query combines event ID and `published` status before loading the event-owned venue and verified media. Drafts never cross the internal published-read boundary, and callers cannot distinguish them from missing IDs. The dedicated contract excludes `created_by_admin_id` and draft lifecycle state.

## Verified Media Upload

1. The client requests an upload for a fixed slot using the event version it read. An occupied slot reserves a replacement while its verified media stays active.
2. Event Service locks the event row, verifies draft state and version, inserts a durable pending upload, and appends `event.media_upload_requested` in one transaction.
3. Event Service returns a create-only presigned R2 `PUT`. The browser uploads directly with the signed content type and `If-None-Match: *` headers. There is no confirmation endpoint.
4. The transaction also appends an immutable job-outbox row. Debezium reads that insert from PostgreSQL WAL and publishes the upload ID through RabbitMQ. The worker may run before the browser completes, so an absent object releases its database claim and retries with bounded backoff until the upload deadline.
5. The worker verifies the stored byte count, declared metadata, detected JPEG, PNG, or WebP content, dimensions, and ETag. A present object is inspected even when the worker wakes at the deadline.
6. Attaching locks the upload and compares the event's stored expected version. An empty slot inserts media and appends `event.media_attached`. An occupied slot atomically swaps the verified reference, appends `event.media_replaced`, and creates durable deletion work for the old object. Both paths increment the event version in the same transaction. Duplicate deliveries cannot attach, replace, increment, or audit twice.
7. Invalid, expired, or version-conflicted uploads remain durable terminal records. The same worker removes their objects with at most ten idempotent deletion attempts.

PostgreSQL is authoritative for scheduling and execution state. RabbitMQ assignments contain only the owning upload or deletion ID. Debezium owns initial publication; the dispatcher polls only for retry and reconciliation after the initial delivery window. Duplicate publication is safe.

## Media Removal

Explicit removal locks the event, verifies draft state and expected version, removes the verified slot, increments the version, appends `event.media_removed`, and creates exact-key object-deletion work in one transaction. An empty slot changes nothing. The object-deletion worker uses PostgreSQL attempts and leases, RabbitMQ assignments containing only the deletion ID, idempotent R2 deletion, and a durable failed state after ten failures.

## Publication

1. The client supplies the version from its latest admin event representation.
2. The repository locks the event and verifies draft state, expected version, complete details, venue presence, and a verified cover reference.
3. One transaction changes the status to `published`, records the publication time, increments the version, appends `event.published`, and inserts one `event.published.v1` outbox fact.
4. Debezium reads the immutable outbox insert from PostgreSQL logical WAL and publishes it to `eventa.event.lifecycle.v1` keyed by event ID.
5. Debezium persists its WAL offset and resumes after failure. Delivery remains at least once, so consumers deduplicate the event ID and version.

Publication never waits for Kafka. PostgreSQL establishes both the published state and the durable fact before the admin response succeeds.

Kafka lifecycle facts and RabbitMQ job assignments use separate Debezium lanes over PostgreSQL logical WAL.

## Audit

The audit table is append-only through the Event application boundary. It records only mutations, including `event.published` and the resulting event version. Reads use ordinary request telemetry and do not grow durable audit history.
