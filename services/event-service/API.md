# Event Service API

## Internal gRPC

Event Service implements `eventa.event.v1.EventService`.

| Operation                | Purpose                                                                           |
| ------------------------ | --------------------------------------------------------------------------------- |
| `CreateDraftEvent`       | Creates a complete private event at version 1.                                    |
| `ListAdminEvents`        | Returns a cursor-paginated admin event catalogue.                                 |
| `GetAdminEvent`          | Returns the latest admin event state, verified images, and version.               |
| `GetPublishedEvent`      | Returns the public representation only when the event is published.               |
| `UpdateDraftEvent`       | Saves complete draft details and returns the new version.                         |
| `CreateEventMediaUpload` | Starts a direct image upload for an empty slot or replacement.                    |
| `GetEventMediaUpload`    | Reports whether an upload is waiting, attached, rejected, conflicted, or expired. |
| `RemoveEventMedia`       | Clears a verified image and returns the new event version.                        |
| `PublishEvent`           | Publishes a complete draft at the expected version.                               |
| `RetireDraftEvent`       | Recoverably removes a draft at the expected version.                              |
| `CreateEventTicketType`  | Adds a priced, allocated ticket type to a draft at the expected version.          |
| `ListEventTicketTypes`   | Returns bounded ticket configuration for an active event.                         |

The protobuf schemas in `packages/grpc-contracts/proto/eventa/event/v1` are authoritative for exact messages and service declarations.

## Operational HTTP

| Method | Path            | Purpose                                                    |
| ------ | --------------- | ---------------------------------------------------------- |
| `GET`  | `/health/live`  | Confirms that the Event process is alive.                  |
| `GET`  | `/health/ready` | Confirms that Event Service can reach its PostgreSQL data. |

Clients do not call Event Service directly. Public HTTP behavior belongs to the API Gateway.
