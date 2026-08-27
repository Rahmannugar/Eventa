# Commerce API

The versioned protobuf contract at `packages/grpc-contracts/proto/eventa/commerce/v1/commerce.proto` is authoritative. Clients use Commerce through the API Gateway; they do not send attendee identity directly.

## Start ticket purchase

`StartTicketPurchase` accepts the authenticated attendee ID, a UUID idempotency key, an Event-owned event and ticket-type ID, and a quantity from 1 to 1,000,000.

Commerce returns the attendee's order. A new order begins in `pending_reservation`. After Event Service returns an active capacity hold and authoritative quote, Commerce atomically stores the immutable ticket snapshot and returns `pending_payment` with currency, total minor units, and reservation expiry.

An exact retry returns the same order. Reusing the attendee idempotency key for another event, ticket type, or quantity returns `ALREADY_EXISTS`. Invalid input returns `INVALID_ARGUMENT`. Event capacity, deadline, and availability failures retain a recoverable `pending_reservation` order and propagate through the Gateway's stable checkout errors.

## Get commerce order

`GetCommerceOrder` accepts the authenticated attendee ID and order ID. It returns only an order owned by that attendee; a missing or differently owned order returns `NOT_FOUND`.

The response contains order, attendee, event, and ticket-type identity; quantity and status; optional currency, total minor units, and reservation expiry; and creation and update times. It does not expose idempotency keys, internal failure details, or provider mechanics.
