# Payment API

Payment is an internal Commerce capability. The ticket-purchase workflow supplies an Eventa order ID, attendee ID, positive integer amount in minor units, and uppercase ISO 4217 currency from Order's immutable quote.

Payment returns the Eventa payment ID and Stripe client secret required for client confirmation. The same order and quote resolve to the same durable Payment record. A resolved retry retrieves its Stripe PaymentIntent; an unresolved retry recreates the request with the same provider idempotency key.

The capability never reports authoritative payment success. It does not expose Stripe identifiers, provider state, idempotency keys, or internal failures to clients.
