# Admin Events Architecture

Gateway authenticates the opaque admin session through Identity before calling Event Service. The resolved admin ID comes only from the server-backed session; the client cannot submit an acting admin ID.

The Gateway validates public input, applies operation-specific abuse controls, propagates the request ID, and calls Event Service with a deadline shorter than the outer HTTP request budget. Event Service owns event rules, persistence, creator provenance, and durable mutation audit history.

Creator identity is not an authorization boundary. Any authenticated admin may retrieve and later mutate any event.
