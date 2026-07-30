# Events Architecture

## State

An event begins in `draft`. The first slice stores its normalized title, creator provenance, and timestamps. Later event-detail migrations extend this same record with the content, schedule, venue, and classification required for publication.

## Draft Creation

1. The controller receives the authenticated admin ID, title, and propagated request ID.
2. The application service normalizes the title.
3. The repository opens one PostgreSQL transaction.
4. It inserts the draft event.
5. It appends `event.created` with the acting admin, event, request ID, and occurrence time.
6. Both rows commit before the response is returned.

## Admin Access

Admin identity authorizes the management surface, not ownership of an individual event. We retain `created_by_admin_id` for provenance. We do not filter reads or mutations by creator.

## Audit

The audit table is append-only through the Event application boundary. It records only mutations. Reads use ordinary request telemetry and do not grow durable audit history.
