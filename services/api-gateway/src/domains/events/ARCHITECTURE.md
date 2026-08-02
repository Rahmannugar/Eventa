# Admin Events Architecture

Gateway authenticates the opaque admin session through Identity before calling Event Service. The resolved admin ID comes only from the server-backed session; the client cannot submit an acting admin ID.

The Gateway validates public input, applies operation-specific abuse controls, propagates the request ID, and calls Event Service with a deadline shorter than the outer HTTP request budget. Event Service owns event rules, persistence, creator provenance, and durable mutation audit history.

Creator identity is not an authorization boundary. Any authenticated admin may retrieve or mutate any event.

Draft updates are full replacements of editable details. Gateway forwards the authenticated admin ID and expected version; Event Service owns schedule validation and the atomic version check. A stale version becomes the stable public conflict response so the client can reload before retrying.

For media, Gateway validates the fixed slot, declared type, per-file size, and expected event version, then forwards the authenticated admin ID. Event Service returns the signed direct-upload contract with distinct upload and verification deadlines. The same contract handles an empty slot or replacement. Gateway does not proxy image bytes and exposes no confirmation command. The client can show a local preview, then poll the authenticated status read after its direct `PUT` completes. Explicit removal forwards the fixed slot and expected version. Polling does not create an audit record. Only Event Service verifies, replaces, or removes R2 references.
