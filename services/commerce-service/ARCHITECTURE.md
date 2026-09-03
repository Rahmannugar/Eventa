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

Terminal provider transitions append one deduplicated workflow outcome in the same Payment transaction. This durable handoff prevents a committed payment result from being separated from its required Order and capacity work.

## Capacity completion and compensation

A bounded worker leases terminal Payment outcomes with `SKIP LOCKED`. Successful payment finalizes the Event-owned reservation before Order becomes paid. Cancellation releases the reservation before Order becomes failed. Event commands are idempotent, and a failed dependency call clears the lease through a durable retry schedule, so a process crash between remote completion and the local transition is safe to replay.

A separate expiry worker leases pending-payment orders whose reservation deadline has elapsed. It re-reads Stripe before touching capacity. An incomplete PaymentIntent is canceled before the Event reservation is released and Order becomes expired. If Stripe has already succeeded, expiry leaves capacity untouched for the terminal Payment workflow.

If successful payment reaches an expired reservation, Order enters refunding and Payment creates or resumes one refund record. The Stripe refund uses a stable Payment-owned idempotency key. Commerce validates refund identity, amount, and currency before Order becomes refunded. A lost provider response reuses the same refund rather than charging compensation twice. A provider-declared failed or canceled refund remains durably failed with Order still refunding and emits an actionable operator failure; repeating the same terminal provider object cannot repair it.

## Retry and recovery

The local order write and remote capacity reservation are deliberately not treated as one transaction. A timeout or rejection leaves the durable order in `pending_reservation`. Retrying the same attendee idempotency key resolves the same order and therefore sends the same Event reservation ID. Event reservation is idempotent, and Commerce row locking plus the one-item-per-order constraint makes repeated or concurrent local completion converge on one snapshot.

Once an order reaches `pending_payment`, an exact checkout retry skips Event and creates or retrieves its Payment attempt. If the first Stripe response is lost, the attempt remains provider-pending and the retry reuses the same Stripe idempotency key. Concurrent calls may overlap at Stripe, but the shared key prevents duplicate PaymentIntents without holding a database transaction open across the provider call. Conflicting checkout idempotency reuse is rejected before new capacity work begins.

Completion and expiry workers expose bounded outcome metrics for success, ordinary retry, and operator attention. Five consecutive failures promote the retry signal to an error while durable automatic retries continue. A terminal refund failure is an immediate error because Stripe requires an alternative reimbursement path.

## Persistence and lifecycle

Drizzle migrations are the deployment authority. A one-shot migration container runs after Commerce PostgreSQL becomes healthy. The service starts only after migration succeeds and Event Service is healthy. Readiness queries Commerce PostgreSQL; liveness reports only process availability. The service closes its PostgreSQL client during graceful shutdown.

The [Payment architecture](src/payments/ARCHITECTURE.md) describes provider, workflow-outcome, reconciliation, and refund persistence. Its [capability contract](src/payments/API.md) defines the internal payment behavior used by the ticket-purchase workflow.
