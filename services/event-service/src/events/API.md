# Events API

`CreateDraftEvent` accepts the authenticated admin ID and a title. Event Service trims the title, requires between one and 160 characters, creates a `draft` at version 1, and returns its authoritative state.

`GetAdminEvent` accepts an event ID. Gateway authentication admits the management request, and any authenticated admin may retrieve any event. A missing event returns gRPC `NOT_FOUND`.

`UpdateDraftEvent` accepts the acting admin, event ID, expected version, title, description, category, ISO-8601 start and end instants, IANA timezone, and venue address. It replaces the editable details and returns the incremented version. The end must be after the start. A stale version returns gRPC `ABORTED`; a missing event returns `NOT_FOUND`.

`CreateEventMediaUpload` accepts the acting admin, event ID, expected version, one fixed media slot, declared image type, and declared byte size. JPEG, PNG, and WebP images up to 8 MiB per file are accepted. The slot must be empty with no pending upload. The response contains a ten-minute create-only R2 `PUT` URL, a separate thirty-minute verification deadline, and the exact signed headers the client must send. A stale version returns `ABORTED`; an occupied slot returns `FAILED_PRECONDITION`; an upload already pending for the slot returns `ALREADY_EXISTS`.

`GetEventMediaUpload` returns `pending`, `attached`, `rejected`, `conflict`, or `expired` with both deadlines from the durable upload record. It does not confirm an upload or change state. Confirmed media appears in subsequent Event responses with its fixed slot, public URL, verified content type, size, width, and height.

Exact message fields remain authoritative in the `eventa.event.v1` protobuf schemas.
