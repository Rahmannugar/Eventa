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

## Audit

The audit table is append-only through the Event application boundary. It records only mutations, including the resulting event version. Reads use ordinary request telemetry and do not grow durable audit history.
