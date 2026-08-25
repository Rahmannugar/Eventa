# Commerce Architecture

Gateway owns checkout HTTP validation, attendee authentication, origin enforcement, abuse controls, request correlation, gRPC translation, response validation, and stable public errors. Commerce Service owns orders, idempotency, the immutable quote, purchase state, and coordination with Event capacity.

Checkout start derives attendee identity from the authenticated session and forwards only that identity, event ID, ticket-type ID, quantity, idempotency key, and request ID. The Commerce call has an absolute deadline shorter than the Gateway request budget. Gateway does not calculate price, availability, capacity, or order state.

Order reads forward the authenticated attendee ID with the order ID. Commerce enforces ownership at its boundary. Gateway also verifies that the returned attendee and order shape match the request before exposing the response.

The domain applies an IP token bucket plus IP-hour and protected-session-hour windows. Mutation and read limits use distinct keys. Redis admission failure closes the route with a safe `503`; Commerce timeout, unavailability, and invalid responses use the same public availability boundary with separate diagnostic codes.
