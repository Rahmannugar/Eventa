# Commerce Architecture

Commerce is an independently deployable NestJS modular monolith over one Commerce-owned PostgreSQL database. Order and Payment are sibling business boundaries. Order owns orders, immutable ticket snapshots, and purchase lifecycle. Payment owns provider interaction and money outcomes. A named ticket-purchase workflow coordinates these boundaries with Event Service; neither domain accesses another service's storage.

## Checkout start

The gRPC controller validates attendee, idempotency, event, ticket-type, and quantity input and passes a bounded request ID into the workflow. The workflow creates or retrieves an order under the database uniqueness constraint on attendee and idempotency key. It uses the durable order ID as Event Service's capacity reservation ID.

Event Service remains the capacity correctness boundary. It locks inventory, enforces availability, waitlist priority, and sales windows, and returns the active hold with ticket name, currency, unit face value, quantity, and expiry. Commerce validates that response at its gRPC adapter, calculates the line total in safe integer minor units, and commits the immutable order item and `pending_payment` transition in one transaction.

## Payment preparation

The ticket-purchase workflow passes only the immutable Order quote and ownership identity into Payment. Payment persists one attempt per order before calling Stripe. The attempt owns its amount, currency, Eventa payment ID, stable Stripe idempotency key, PaymentIntent ID, and provider status. Database constraints prevent another attempt, provider key, or PaymentIntent from being attached to the same operation.

Stripe receives the amount in minor units, lowercase currency, and Eventa order and payment IDs as metadata. Payment validates those values, the PaymentIntent identity and status, and the client-secret relationship before making the attempt confirmation-ready. The client secret is never persisted. A resolved retry retrieves the PaymentIntent to return and revalidate its secret.

The synchronous Stripe response is not a payment outcome. The Order remains `pending_payment` until a signed webhook or reconciliation establishes authoritative provider state.

## Provider truth and reconciliation

Stripe calls Commerce directly over HTTP. Nest preserves the raw request bytes, and the Stripe adapter verifies them with the endpoint signing secret before Payment accepts an event. Payment stores the bounded event identity, type, PaymentIntent ID, provider timestamp, processing state, and associated Eventa payment. It never stores the webhook payload. The provider event ID is the delivery deduplication key; repeated or concurrently delivered events converge through the same locked event row.

After durable receipt, Payment retrieves the current PaymentIntent instead of treating an event snapshot as the latest state. It validates the amount, currency, PaymentIntent identity, and Eventa order/payment metadata. The provider-event result and Payment transition commit in one transaction. A `payment_intent.created` event can bind a provider-pending Payment after a lost create response. Older deliveries and concurrent observations cannot move a terminal Payment backward.

Payment distinguishes waiting for confirmation, required attendee action, provider processing, a failed confirmation attempt, success, and cancellation. A failed confirmation is not cancellation: Stripe can return the same PaymentIntent to `requires_payment_method` for another attempt.

A bounded in-process worker claims due non-terminal Payments with expiring PostgreSQL leases and `SKIP LOCKED`. It retrieves current PaymentIntent state outside the database transaction, then applies the same validation and state mapping. A provider-pending Payment without a stored PaymentIntent ID replays creation with its original durable Stripe idempotency key, which recovers an ambiguous create response without creating another intent. Multiple Commerce instances divide work safely. Provider failures release the claim and schedule bounded exponential backoff. Webhooks remain the primary path; reconciliation recovers missed or delayed delivery.

This boundary records provider truth only. The ticket-purchase workflow applies Order and Event-capacity consequences in its later coordination step.

## Retry and recovery

The local order write and remote capacity reservation are deliberately not treated as one transaction. A timeout or rejection leaves the durable order in `pending_reservation`. Retrying the same attendee idempotency key resolves the same order and therefore sends the same Event reservation ID. Event reservation is idempotent, and Commerce row locking plus the one-item-per-order constraint makes repeated or concurrent local completion converge on one snapshot.

Once an order reaches `pending_payment`, an exact checkout retry skips Event and creates or retrieves its Payment attempt. If the first Stripe response is lost, the attempt remains provider-pending and the retry reuses the same Stripe idempotency key. Concurrent calls may overlap at Stripe, but the shared key prevents duplicate PaymentIntents without holding a database transaction open across the provider call. Conflicting checkout idempotency reuse is rejected before new capacity work begins.

## Persistence and lifecycle

Drizzle migrations are the deployment authority. A one-shot migration container runs after Commerce PostgreSQL becomes healthy. The service starts only after migration succeeds and Event Service is healthy. Readiness queries Commerce PostgreSQL; liveness reports only process availability. The service closes its PostgreSQL client during graceful shutdown.

The [Payment architecture](src/payments/ARCHITECTURE.md) describes the provider and persistence boundary in detail. Its [capability contract](src/payments/API.md) defines the inputs and confirmation result used by the ticket-purchase workflow.
