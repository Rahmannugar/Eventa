# Identity Service API

## Business Domains

Identity implements the attendee and admin services in `eventa.identity.v1`.

| Domain    | Internal surface                          | Documentation                         |
| --------- | ----------------------------------------- | ------------------------------------- |
| Admins    | `AdminIdentityService` gRPC operations    | [Admins API](src/admins/API.md)       |
| Attendees | `AttendeeIdentityService` gRPC operations | [Attendees API](src/attendees/API.md) |

The protobuf file is authoritative for service names, method names, wire fields, and field numbers. Domain API files explain command/query behavior and failures without duplicating the machine-readable contract.

## Operational HTTP

| Method | Path            | Purpose                                                                         |
| ------ | --------------- | ------------------------------------------------------------------------------- |
| `GET`  | `/health/live`  | Confirms the Identity process is alive.                                         |
| `GET`  | `/health/ready` | Executes `SELECT 1` against Identity PostgreSQL and returns readiness or `503`. |

Business operations are not exposed over Identity's HTTP health listener.
