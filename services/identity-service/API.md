# Identity Service API

## Business Domains

Identity implements `eventa.identity.v1.AttendeeIdentityService` from [../../packages/grpc-contracts/proto/identity.proto](../../packages/grpc-contracts/proto/identity.proto).

| Domain    | Internal surface                          | Documentation                         |
| --------- | ----------------------------------------- | ------------------------------------- |
| Attendees | `AttendeeIdentityService` gRPC operations | [Attendees API](src/attendees/API.md) |

The protobuf file is authoritative for service names, method names, wire fields, and field numbers. Domain API files explain command/query behavior and failures without duplicating the machine-readable contract.

## Operational HTTP

| Method | Path            | Purpose                                                                         |
| ------ | --------------- | ------------------------------------------------------------------------------- |
| `GET`  | `/health/live`  | Confirms the Identity process is alive.                                         |
| `GET`  | `/health/ready` | Executes `SELECT 1` against Identity PostgreSQL and returns readiness or `503`. |

Business operations are not exposed over Identity's HTTP health listener.
