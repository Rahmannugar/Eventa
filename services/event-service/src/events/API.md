# Events API

`CreateDraftEvent` accepts the authenticated admin ID and a title. Event Service trims the title, requires between one and 160 characters, creates a `draft` at version 1, and returns its authoritative state.

`GetAdminEvent` accepts an event ID. Gateway authentication admits the management request, and any authenticated admin may retrieve any event. A missing event returns gRPC `NOT_FOUND`.

`UpdateDraftEvent` accepts the acting admin, event ID, expected version, title, description, category, ISO-8601 start and end instants, IANA timezone, and venue address. It replaces the editable details and returns the incremented version. The end must be after the start. A stale version returns gRPC `ABORTED`; a missing event returns `NOT_FOUND`.

Exact message fields remain authoritative in the `eventa.event.v1` protobuf schemas.
