# Events API

`CreateDraftEvent` accepts the authenticated admin ID and a title. Event Service trims the title, requires between one and 160 characters, creates a `draft`, and returns its ID, title, status, creator provenance, and timestamps.

`GetAdminEvent` accepts an event ID. Gateway authentication admits the management request, and any authenticated admin may retrieve any event. A missing event returns gRPC `NOT_FOUND`.

Exact message fields remain authoritative in the `eventa.event.v1` protobuf schemas.
