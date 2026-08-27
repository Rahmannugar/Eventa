# Commerce Architecture

Commerce is an independently deployable NestJS modular monolith over one Commerce-owned PostgreSQL database. Order and Payment are sibling business boundaries. Order owns orders, immutable ticket snapshots, and purchase lifecycle. Payment owns provider interaction and money outcomes. A named ticket-purchase workflow coordinates these boundaries with Event Service; neither domain accesses another service's storage.

## Checkout start

The gRPC controller validates attendee, idempotency, event, ticket-type, and quantity input and passes a bounded request ID into the workflow. The workflow creates or retrieves an order under the database uniqueness constraint on attendee and idempotency key. It uses the durable order ID as Event Service's capacity reservation ID.

Event Service remains the capacity correctness boundary. It locks inventory, enforces availability, waitlist priority, and sales windows, and returns the active hold with ticket name, currency, unit face value, quantity, and expiry. Commerce validates that response at its gRPC adapter, calculates the line total in safe integer minor units, and commits the immutable order item and `pending_payment` transition in one transaction.

## Retry and recovery

The local order write and remote capacity reservation are deliberately not treated as one transaction. A timeout or rejection leaves the durable order in `pending_reservation`. Retrying the same attendee idempotency key resolves the same order and therefore sends the same Event reservation ID. Event reservation is idempotent, and Commerce row locking plus the one-item-per-order constraint makes repeated or concurrent local completion converge on one snapshot.

Once an order reaches `pending_payment`, an exact checkout retry returns it without another Event call. Conflicting idempotency reuse is rejected before new capacity work begins.

## Persistence and lifecycle

Drizzle migrations are the deployment authority. A one-shot migration container runs after Commerce PostgreSQL becomes healthy. The service starts only after migration succeeds and Event Service is healthy. Readiness queries Commerce PostgreSQL; liveness reports only process availability. The service closes its PostgreSQL client during graceful shutdown.
