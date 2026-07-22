# Identity Service API

## gRPC Contract

Identity implements `eventa.identity.v1.AttendeeIdentityService` from [../../packages/grpc-contracts/proto/identity.proto](../../packages/grpc-contracts/proto/identity.proto).

### RegisterAttendee

Request fields:

- `email`
- `password`
- `username`

Successful response fields:

- `attendee_id`
- canonical `email`
- canonical `username`
- `email_verified`, currently `false` at registration

gRPC outcomes:

| Status             | Meaning                                                       |
| ------------------ | ------------------------------------------------------------- |
| `INVALID_ARGUMENT` | Boundary validation rejected the command.                     |
| `ALREADY_EXISTS`   | Canonical attendee email or username uniqueness was violated. |
| `UNKNOWN`          | An unexpected unhandled internal failure occurred.            |

The protobuf file is authoritative for field numbers, wire names, package version, and service method names.

The Gateway forwards `x-request-id` as optional gRPC metadata. Identity includes it in its completion log when present; direct gRPC clients may omit it.

## Operational HTTP

| Method | Path            | Purpose                                                                         |
| ------ | --------------- | ------------------------------------------------------------------------------- |
| `GET`  | `/health/live`  | Confirms the Identity process is alive.                                         |
| `GET`  | `/health/ready` | Executes `SELECT 1` against Identity PostgreSQL and returns readiness or `503`. |

Business operations are not exposed over Identity's HTTP health listener.
