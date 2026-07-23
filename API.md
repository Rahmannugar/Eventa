# Eventa API

## Public API Map

Clients communicate with Eventa through the API Gateway over HTTP. The currently implemented business endpoint is:

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

Synchronous service commands and queries use gRPC. The current contract is `eventa.identity.v1.AttendeeIdentityService`, defined in [packages/grpc-contracts/proto/identity/v1/attendee_identity_service.proto](packages/grpc-contracts/proto/identity/v1/attendee_identity_service.proto).

Identity also exposes operational HTTP health endpoints; it does not expose business HTTP routes directly to clients. See [services/identity-service/API.md](services/identity-service/API.md).

Each service documents its owned internal surface in its own `API.md`. Future event-bus and job-queue contracts will be documented beside their producing and consuming services when implemented.
