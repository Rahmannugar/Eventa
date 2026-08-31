# Commerce API

Both routes require the opaque attendee session cookie. Gateway derives attendee identity from the server-backed session and never accepts it from the client.

| Method | Path                 | Outcome                                                                   |
| ------ | -------------------- | ------------------------------------------------------------------------- |
| `POST` | `/checkout`          | Starts or resumes one ticket checkout under the supplied idempotency key. |
| `GET`  | `/checkout/:orderId` | Returns the signed-in attendee's order.                                   |

Checkout start accepts an event ID, ticket-type ID, quantity, and UUID idempotency key. The response contains the order identity, requested ticket identity and quantity, purchase state, quote, reservation deadline, and a nested payment object with the Eventa payment ID and client secret needed for Stripe confirmation. Exact retries return the same order and payment identity. Reusing the idempotency key for different ticket details returns `409 CHECKOUT_IDEMPOTENCY_CONFLICT`.

The client secret appears only in the authenticated `POST /checkout` response. `GET /checkout/:orderId` never returns it. The checkout response does not claim payment success; authoritative payment state follows signed provider updates.

An order belonging to another attendee is indistinguishable from a missing order and returns `404 ORDER_NOT_FOUND`. Unavailable capacity returns `409 TICKETS_UNAVAILABLE`; a ticket that cannot be purchased returns `409 CHECKOUT_NOT_AVAILABLE`. Dependency or deadline failures return `503` without exposing service or transport details.

Checkout start requires the configured attendee-client origin. Start and read use separate IP and protected-session limits under the Commerce checkout policy.
