# Events Architecture

Public retrieval uses `GET /events/:eventId` without an admin session. Gateway validates the event ID, applies an IP-only read budget, propagates the request ID, and calls the dedicated published-event gRPC query under the Event deadline. Event Service owns the published-state predicate. Gateway therefore cannot accidentally broaden the public query to include drafts. Missing and draft IDs share one public not-found response.

The public representation excludes creator provenance and draft lifecycle state. Verified media remains Event-owned data returned by the authoritative query; Gateway only translates the internal contract to HTTP.

Gateway authenticates the opaque admin session through Identity before calling Event Service. The resolved admin ID comes only from the server-backed session; the client cannot submit an acting admin ID.

The admin catalogue forwards bounded cursor pagination to Event Service and maps the returned summaries to HTTP. Gateway does not join event data, interpret categories, or own ordering rules.

The Gateway validates public input, applies operation-specific abuse controls, propagates the request ID, and calls Event Service with a deadline shorter than the outer HTTP request budget. Event Service owns event rules, persistence, creator provenance, and durable mutation audit history.

Creator identity is not an authorization boundary. Any authenticated admin may retrieve or mutate any event.

Creation forwards the authenticated admin and complete event input as one command. Draft updates are full replacements of editable details. Gateway forwards the authenticated admin ID and expected version; Event Service owns category normalization, schedule validation, atomic persistence, and the version check. A stale version becomes the stable public conflict response so the client can reload before retrying.

Publication has its own abuse budget. Gateway forwards the authenticated admin ID and expected version under the Event gRPC deadline. Event Service alone decides whether the draft is complete and performs the lifecycle transition. Gateway translates an incomplete draft to a correctable `422` response and version or lifecycle conflicts to `409`.

Draft retirement has a separate abuse budget. Gateway forwards the authenticated admin ID, event ID, expected version, and request correlation under the Event deadline. Event Service owns soft deletion and idempotency. Gateway maps retired drafts to ordinary not-found reads and rejects published-event removal without treating it as cancellation.

Ticket-type reads and creation use dedicated Event gRPC operations. Gateway validates transport shape, derives the admin ID from the session, applies separate read and mutation budgets, propagates the request ID, and bounds the call with the Event deadline. Event Service owns currency, price, allocation, schedule, uniqueness, count, draft-state, version, transaction, and audit rules. Gateway validates the returned event ID and response shape before exposing it to the client.

For media, Gateway validates the fixed slot, declared type, per-file size, and expected event version, then forwards the authenticated admin ID. Event Service returns the signed direct-upload contract with distinct upload and verification deadlines. The same contract handles an empty slot or replacement. Gateway does not proxy image bytes and exposes no confirmation command. The client can show a local preview, then poll the authenticated status read after its direct `PUT` completes. Polling has a separate abuse budget sized for the verification deadline, so it cannot exhaust ordinary catalogue and detail reads. Explicit removal forwards the fixed slot and expected version. Polling does not create an audit record. Only Event Service verifies, replaces, or removes R2 references.
