# Events API

`CreateDraftEvent` accepts the authenticated admin ID, title, description, one to five categories, ISO-8601 start and end instants, IANA timezone, and venue address. Event Service normalizes those values, requires the end to follow the start, creates the complete private event at version 1, and returns its state.

`ListAdminEvents` accepts a bounded page size and optional opaque page token. It returns events ordered by latest update, including status, categories, schedule, timezone, venue, and an opaque token when another page exists.

`GetAdminEvent` accepts an event ID. Gateway authentication admits the management request, and any authenticated admin may retrieve any event. A missing event returns gRPC `NOT_FOUND`.

`GetPublishedEvent` accepts an event ID and returns content, schedule, venue, verified media, publication time, and version only when the authoritative event state is `published`. It omits creator provenance and draft lifecycle state. Draft and missing IDs both return gRPC `NOT_FOUND`.

`UpdateDraftEvent` accepts the acting admin, event ID, expected version, title, description, one to five categories, ISO-8601 start and end instants, IANA timezone, and venue address. It replaces the editable details and returns the incremented version. The end must be after the start. A stale version returns gRPC `ABORTED`; a missing event returns `NOT_FOUND`.

`CreateEventMediaUpload` accepts the acting admin, event ID, expected version, one fixed media slot, declared image type, and declared byte size. JPEG, PNG, and WebP images up to 8 MiB per file are accepted. An empty slot creates new media; an occupied slot reserves a replacement while its verified image remains authoritative. Only one upload may be pending for a slot. The response contains a ten-minute create-only R2 `PUT` URL, a separate thirty-minute verification deadline, and the exact signed headers the client must send. A stale version returns `ABORTED`; an upload already pending for the slot returns `ALREADY_EXISTS`.

`GetEventMediaUpload` tells the caller whether to keep polling, reload the event, or ask the admin to try again. `pending` means upload or verification is still active. `attached` includes the resulting event version. `rejected` means the object failed validation or verification could not finish. `conflict` means the event changed after the upload began. `expired` means no object arrived before the upload deadline. The response includes the upload and verification deadlines and a stable failure code where applicable. This read never confirms or changes an upload.

Accepted media appears in Event responses with its fixed slot, public URL, verified content type, size, width, and height.

`RemoveEventMedia` accepts the acting admin, event ID, expected version, and fixed slot. The verified reference disappears immediately and the response returns the incremented event version. Physical object deletion continues through durable background work. A stale version returns `ABORTED`, a missing event returns `NOT_FOUND`, and an empty slot returns `FAILED_PRECONDITION`.

`PublishEvent` accepts the acting admin, event ID, and expected version. Publication requires complete details, one venue, and a verified cover image. It returns the event as `published` with an incremented version and publication time. A missing event returns `NOT_FOUND`, an incomplete draft returns `FAILED_PRECONDITION`, and a stale version or already-published event returns `ABORTED`.

Exact message fields remain authoritative in the `eventa.event.v1` protobuf schemas.
