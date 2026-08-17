# Events Architecture

## State

An event begins in `draft` at version 1 with its normalized title, description, one to five categories, schedule, IANA timezone, and one event-owned venue address. Publication additionally requires one verified cover image and at least one ticket type. A published event has an immutable publication time and no longer accepts draft, media, or ticket-type mutations. A draft may carry a retirement time; retired rows remain recoverable but are excluded from ordinary reads and mutations.

## Draft Creation

1. The controller receives the authenticated admin ID, event details, schedule, venue, and propagated request ID.
2. The application service normalizes text and categories and validates the schedule.
3. The repository opens one PostgreSQL transaction.
4. It inserts the draft, venue, category rows, and `event.created` audit entry.
5. All rows commit before the response is returned. A failure rolls back the complete creation.

## Draft Editing

1. The client sends the version from its latest event representation. Gateway derives the acting admin ID from the authenticated server-backed session and attaches both values to the internal command.
2. PostgreSQL updates the draft only when its ID, `draft` status, and version match, then increments the version.
3. The same transaction replaces the categories, upserts the event venue, and appends `event.updated` with the resulting version.
4. A competing update with the stale version changes nothing and returns a version conflict.

## Admin Catalogue

The management list reads Event-owned event, venue, and category data. It uses stable keyset orders over update time or event date with event ID as the tie-breaker. Opaque page tokens bind the cursor to normalized search, venue filters, and sort criteria, so callers cannot reuse a cursor against another query shape. Categories are loaded in one bounded query for the page rather than one query per event.

Trigram search indexes normalized event titles for substring matching. Composite venue-code and event time indexes support dependent location filters and both catalogue orders. Display region names remain content; only structured region codes participate in exact filtering.

Catalogue time and title indexes are partial over active rows. Retired drafts therefore do not accumulate in the index paths used by ordinary management queries.

## Admin Access

Admin identity authorizes the management surface, not ownership of an individual event. We retain `created_by_admin_id` for provenance. We do not filter reads or mutations by creator.

## Ticket Catalogue

An event owns one or more unique ticket-currency definitions. Every ticket type references exactly one of those definitions, so NGN, USD, GBP, or other supported offerings remain grouped without repeating currency on each ticket-type row. Ticket types store normalized names, optional descriptions, face values in integer minor units, capacity, reserved and sold quantities, sales windows, and recoverable retirement state. Available quantity is derived as capacity minus reserved and sold. Event capacity is derived from ticket-type capacity rather than duplicated as an independently editable event total.

Currency definition and ticket-type creation both lock the event row, verify active draft state and expected version, perform their insert, increment the event version, and append their audit action in one transaction. The event-row lock serializes both mutation paths. A ticket type must reference a currency owned by the same event. PostgreSQL also enforces unique event currencies, price, capacity, window, normalization, foreign-key, and case-insensitive name uniqueness within one currency.

Ticket-type updates and retirement use the same event-row serialization on active drafts and published events. Display details remain editable. Once any quantity is reserved or sold, price and sales bounds are immutable; capacity always remains at least reserved plus sold. Retirement requires no committed quantity, and a published event retains at least one active type. Retired types leave ordinary catalogue and publication queries but remain durable for audit and exact retry recovery.

The management read joins the event to currencies through `(event_id, created_at, id)` and active types through the partial `(ticket_currency_id, created_at, id)` index in one statement. At most 20 active ticket types can belong to one event, so the catalogue read remains bounded and internally consistent.

## Capacity Reservations

A caller-generated reservation ID is the durable idempotency key. Reserving locks only the selected ticket type, verifies published state and the sales window, reclaims any due holds for that type, checks available quantity, inserts a reservation, and increments reserved quantity in one transaction. The deadline is the earliest of ten minutes, the sales end, and the event start. Concurrent reservations for different ticket types do not serialize through the event row.

Finalization, release, and expiry lock the ticket type before changing the reservation. Finalization moves quantity from reserved to sold; release and expiry remove it from reserved. The reservation has one terminal state, so duplicate or competing commands cannot change counters twice. Catalogue edits lock the event and then the ticket type, preserving the same type-lock boundary without creating a reverse lock dependency. Capacity transactions bound lock waits and return a retryable result instead of queueing indefinitely behind a hot ticket type.

PostgreSQL is the expiry authority. A partial expiry index supports a bounded in-process sweep, and reserve also reclaims due holds before checking availability. The sweeper can repeat after a crash or run from several service instances because each expiry transition is durable and idempotent. No queue or process timer is treated as reservation truth.

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
2. The repository locks the event and verifies draft state, expected version, complete details, venue presence, a verified cover reference, and at least one ticket type.
3. One transaction changes the status to `published`, records the publication time, increments the version, appends `event.published`, and inserts one `event.published.v1` outbox fact.
4. Debezium reads the immutable outbox insert from PostgreSQL logical WAL and publishes it to `eventa.event.lifecycle.v1` keyed by event ID.
5. Debezium persists its WAL offset and resumes after failure. Delivery remains at least once, so consumers deduplicate the event ID and version.

Publication never waits for Kafka. PostgreSQL establishes both the published state and the durable fact before the admin response succeeds.

## Draft Retirement

Retirement locks the event row and accepts only an active draft at the expected version. One transaction sets the retirement time, increments the version, and appends `event.retired` with the acting admin and request ID. A repeated command returns the stored retirement version without another state change or audit entry. Published events remain active because cancellation is a separate lifecycle workflow.

Kafka lifecycle facts and RabbitMQ job assignments use separate Debezium lanes over PostgreSQL logical WAL.

## Audit

The audit table is append-only through the Event application boundary. It records only mutations, including `event.ticket_type_created`, `event.published`, `event.retired`, and the resulting event version. Reads use ordinary request telemetry and do not grow durable audit history.
