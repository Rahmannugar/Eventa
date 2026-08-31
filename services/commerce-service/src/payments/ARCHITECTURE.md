# Payment Architecture

Payment owns durable payment attempts and the Stripe adapter. Its repository accesses only Payment tables. The ticket-purchase workflow coordinates Order's immutable quote with Payment; Payment never reads the Order repository.

We persist the Eventa payment ID, order and attendee identity, amount, currency, Stripe idempotency key, PaymentIntent ID, provider status, and local attempt state before or after the corresponding provider boundary requires each fact. We never persist the client secret.

One database row exists per order. Provider idempotency and PaymentIntent identities are unique. The Stripe request carries Eventa order and payment IDs as metadata. The service validates provider identity, amount, currency, metadata, status, and client-secret relationship before returning confirmation data.

We do not hold a database transaction across Stripe calls. An ambiguous response leaves a provider-pending record whose stable idempotency key makes the retry safe. A stored PaymentIntent is retrieved and revalidated on later checkout retries.

Provider creation and retrieval do not change the Order to paid. Signed webhook handling and scheduled reconciliation own authoritative provider transitions.
