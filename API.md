# Eventa API

## Public API Map

Clients communicate with Eventa through the API Gateway over HTTP.

| Method | Path                       | Outcome                                                                                          |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------ |
| `POST` | `/auth/attendees/register` | Creates an unverified attendee account after registration rate limiting and Identity validation. |

The Gateway also exposes:

- Scalar API reference at `/docs`;
- OpenAPI JSON at `/openapi.json`;
- OpenAPI YAML at `/openapi.yaml`;
- process liveness at `/health/live`.

This root file remains a compact map as Eventa grows; it does not duplicate every endpoint, example, or response. The generated OpenAPI documents are the authoritative public HTTP contract. See [services/api-gateway/API.md](services/api-gateway/API.md) for Gateway boundary behavior and error translation.

## Internal Contracts

Synchronous service commands and queries use gRPC. `eventa.identity.v1.AttendeeIdentityService` is defined in [packages/grpc-contracts/proto/eventa/identity/v1/attendee_identity_service.proto](packages/grpc-contracts/proto/eventa/identity/v1/attendee_identity_service.proto).

The protobuf schemas are authoritative. Buf validates and generates the TypeScript message, client, controller, package, and service declarations exported by `@eventa/grpc-contracts`; consumers do not hand-maintain protobuf-derived TypeScript shapes.

Identity also exposes operational HTTP health endpoints; it does not expose business HTTP routes directly to clients. See [services/identity-service/API.md](services/identity-service/API.md).

We publish `AttendeeEmailVerificationJob` version `1` from Identity and consume it in Notification. `@eventa/messaging-contracts` owns the contract. Notification exposes only operational HTTP health endpoints. See [services/notification-service/API.md](services/notification-service/API.md).

Each service documents its owned internal surface in its own `API.md`.
