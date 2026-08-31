# Commerce API

The versioned protobuf contract at `packages/grpc-contracts/proto/eventa/commerce/v1/commerce.proto` is authoritative. Clients use Commerce through the API Gateway; they do not send attendee identity directly.

## Start ticket purchase

`StartTicketPurchase` accepts the authenticated attendee ID, a UUID idempotency key, an Event-owned event and ticket-type ID, and a quantity from 1 to 1,000,000.

Commerce returns the attendee's order and client payment confirmation. A new order begins in `pending_reservation`. After Event Service returns an active capacity hold and authoritative quote, Commerce atomically stores the immutable ticket snapshot and moves the order to `pending_payment`. Payment creates or retrieves one Stripe PaymentIntent from that quote. The response contains the Eventa payment ID and Stripe client secret alongside the order currency, total minor units, and reservation expiry.

An exact retry returns the same order and payment identity. It does not reserve capacity again. A provider retry uses the Payment-owned durable idempotency key; a resolved retry retrieves and revalidates the recorded PaymentIntent. Reusing the attendee idempotency key for another event, ticket type, or quantity returns `ALREADY_EXISTS`. Invalid input returns `INVALID_ARGUMENT`. Event capacity, deadline, and availability failures retain a recoverable `pending_reservation` order. Stripe availability failures retain a recoverable `pending_payment` order and durable provider-pending payment.

The client secret is returned only through the authenticated checkout response. Commerce does not store it or include it in logs, URLs, order reads, or provider metadata. Creating, retrieving, or confirming a PaymentIntent does not mark the order paid. Signed Stripe webhooks and reconciliation establish payment outcomes.

## Get commerce order

`GetCommerceOrder` accepts the authenticated attendee ID and order ID. It returns only an order owned by that attendee; a missing or differently owned order returns `NOT_FOUND`.

The response contains order, attendee, event, and ticket-type identity; quantity and status; optional currency, total minor units, and reservation expiry; and creation and update times. It does not expose idempotency keys, internal failure details, or provider mechanics.
