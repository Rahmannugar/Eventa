# Event Service API

## Internal gRPC

Event Service implements `eventa.event.v1.EventService`.

| Operation          | Purpose                                                         |
| ------------------ | --------------------------------------------------------------- |
| `CreateDraftEvent` | Creates a title-only draft and records the acting admin action. |
| `GetAdminEvent`    | Returns an event for an authenticated admin management request. |

The protobuf schemas in `packages/grpc-contracts/proto/eventa/event/v1` are authoritative for exact messages and service declarations.

## Operational HTTP

| Method | Path            | Purpose                                                    |
| ------ | --------------- | ---------------------------------------------------------- |
| `GET`  | `/health/live`  | Confirms that the Event process is alive.                  |
| `GET`  | `/health/ready` | Confirms that Event Service can reach its PostgreSQL data. |

Clients do not call Event Service directly. Public HTTP behavior belongs to the API Gateway.
