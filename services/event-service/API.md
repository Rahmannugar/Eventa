# Event Service API

## Internal gRPC

Event Service implements `eventa.event.v1.EventService`.

| Operation                | Purpose                                                                           |
| ------------------------ | --------------------------------------------------------------------------------- |
| `CreateDraftEvent`       | Starts a title-only draft at version 1.                                           |
| `GetAdminEvent`          | Returns the latest admin event state, verified images, and version.               |
| `UpdateDraftEvent`       | Saves complete draft details and returns the new version.                         |
| `CreateEventMediaUpload` | Starts a direct image upload for an empty slot or replacement.                    |
| `GetEventMediaUpload`    | Reports whether an upload is waiting, attached, rejected, conflicted, or expired. |
| `RemoveEventMedia`       | Clears a verified image and returns the new event version.                        |
| `PublishEvent`           | Publishes a complete draft at the expected version.                               |

The protobuf schemas in `packages/grpc-contracts/proto/eventa/event/v1` are authoritative for exact messages and service declarations.

## Operational HTTP

| Method | Path            | Purpose                                                    |
| ------ | --------------- | ---------------------------------------------------------- |
| `GET`  | `/health/live`  | Confirms that the Event process is alive.                  |
| `GET`  | `/health/ready` | Confirms that Event Service can reach its PostgreSQL data. |

Clients do not call Event Service directly. Public HTTP behavior belongs to the API Gateway.
