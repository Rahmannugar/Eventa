# Payment Architecture

Payment owns durable payment attempts and the Stripe adapter. Its repository accesses only Payment tables. The ticket-purchase workflow coordinates Order's immutable quote with Payment; Payment never reads the Order repository.

We persist the Eventa payment ID, order and attendee identity, amount, currency, Stripe idempotency key, PaymentIntent ID, provider status, and local attempt state before or after the corresponding provider boundary requires each fact. We never persist the client secret.

One database row exists per order. Provider idempotency and PaymentIntent identities are unique. The Stripe request carries Eventa order and payment IDs as metadata. The service validates provider identity, amount, currency, metadata, status, and client-secret relationship before returning confirmation data.

We do not hold a database transaction across Stripe calls. An ambiguous response leaves a provider-pending record whose stable idempotency key makes the retry safe. A stored PaymentIntent is retrieved and revalidated on later checkout retries.

Provider creation and retrieval during checkout do not change the Order to paid. Signed webhook handling and scheduled reconciliation own authoritative provider transitions.

Commerce preserves raw request bytes only long enough for the Stripe adapter to verify the endpoint signature. Payment then stores one bounded provider-event record keyed by Stripe event ID. It retains no arbitrary webhook payload, client secret, provider error text, or submitted payment details. A received record remains retryable until its Payment update or deliberate unrelated-event result commits.

The webhook path retrieves the PaymentIntent's current state after recording the delivery. It validates the provider identity, immutable money snapshot, and Eventa metadata before binding or updating a Payment. Event timestamps prevent older deliveries from replacing newer observations, terminal states do not regress, and distinct Stripe events for the same object remain harmless because Payment transitions are idempotent.

The local states distinguish `awaiting_confirmation`, `requires_action`, `processing`, `failed`, `succeeded`, and `canceled`. Stripe's `requires_payment_method` maps to `failed` only when the PaymentIntent has a last payment error; otherwise it remains confirmation-ready. This preserves retryable card failure without treating it as irreversible cancellation.

Reconciliation claims a bounded due batch with expiring PostgreSQL leases and `SKIP LOCKED`. Stripe calls happen after the claim transaction closes. A provider-pending row without a PaymentIntent ID safely replays creation with its original Stripe idempotency key; resolved rows retrieve their recorded intent. Successful observations clear retry state and schedule another check only for non-terminal Payments. Provider failures increment durable retry state and use bounded exponential backoff. A second service instance can reclaim an expired lease after process failure.

Webhook and reconciliation state stays inside Payment. A terminal transition inserts one deduplicated workflow outcome in the same transaction. The ticket-purchase workflow leases that handoff before commanding Event capacity and transitioning Order, so retries cannot lose the required consequence.

Payment also owns durable compensating refunds. One refund row is unique by Payment, Order, and provider idempotency key. Provider calls occur outside database transactions. A returned refund ID is persisted before later retrieval, and every response is checked against the immutable PaymentIntent, amount, and currency. Ambiguous creation retries the stable key; a resolved retry retrieves the recorded refund. Pending or action-required refunds remain reconcilable. A provider-declared failed or canceled refund becomes durable failed evidence for an alternative operator-owned reimbursement path.
