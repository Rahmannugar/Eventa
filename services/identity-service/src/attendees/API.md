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

The Gateway may forward `x-request-id` as gRPC metadata; direct clients may omit it. The service contract at [../../../../packages/grpc-contracts/proto/eventa/identity/v1/attendee_identity_service.proto](../../../../packages/grpc-contracts/proto/eventa/identity/v1/attendee_identity_service.proto) and its imported registration messages are authoritative for service names, methods, wire fields, and field numbers.

## LoginAttendee Command

The request contains `email` and `password`. Success returns the active attendee projection, including `status = active`, plus one opaque session token and its absolute expiry for the Gateway transport boundary.

| gRPC status           | Meaning                                                                     |
| --------------------- | --------------------------------------------------------------------------- |
| `INVALID_ARGUMENT`    | Identity validation rejected the command shape.                             |
| `UNAUTHENTICATED`     | The email or password is incorrect.                                         |
| `FAILED_PRECONDITION` | Correct credentials belong to an unverified, suspended, or deleted account. |
| `UNAVAILABLE`         | Live session state could not be created.                                    |

## ConfirmAttendeeEmailVerification Command

The request contains `email` and a six-digit `otp`. Success returns `email_verified = true`, including an exact replay of an already-confirmed OTP while its original Redis state remains valid.

| gRPC status           | Meaning                                                       |
| --------------------- | ------------------------------------------------------------- |
| `INVALID_ARGUMENT`    | Identity validation rejected the command shape.               |
| `FAILED_PRECONDITION` | The OTP is invalid, expired, replaced, missing, or exhausted. |
| `UNAVAILABLE`         | Verification state could not be read or changed.              |

## ResendAttendeeEmailVerification Command

The request contains `email`. Success returns `accepted = true` without disclosing whether the attendee exists or is already verified. Identity reserves the 60-second cooldown before account lookup and publishes a replacement OTP job only for an existing unverified attendee.

| gRPC status          | Meaning                                          |
| -------------------- | ------------------------------------------------ |
| `INVALID_ARGUMENT`   | Identity validation rejected the command shape.  |
| `RESOURCE_EXHAUSTED` | The per-email resend cooldown is active.         |
| `UNAVAILABLE`        | Verification state could not be read or changed. |
