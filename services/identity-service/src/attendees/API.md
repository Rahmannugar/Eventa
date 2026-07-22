# Identity Attendees Domain API

## RegisterAttendee Command

Identity implements `RegisterAttendee` on `eventa.identity.v1.AttendeeIdentityService`.

Request fields:

- `email`
- `password`
- `username`

Successful response fields:

- `attendee_id`
- canonical `email`
- canonical `username`
- `email_verified`, which is `false` at registration

| gRPC status        | Meaning                                                       |
| ------------------ | ------------------------------------------------------------- |
| `INVALID_ARGUMENT` | Identity validation rejected the command.                     |
| `ALREADY_EXISTS`   | Canonical attendee email or username uniqueness was violated. |
| `UNKNOWN`          | An unexpected unhandled internal failure occurred.            |

The Gateway may forward `x-request-id` as gRPC metadata; direct clients may omit it. The protobuf file at [../../../../packages/grpc-contracts/proto/identity.proto](../../../../packages/grpc-contracts/proto/identity.proto) is authoritative for service names, methods, wire fields, and field numbers.
