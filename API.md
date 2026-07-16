# Eventa API

## Current Public API

Clients communicate with Eventa through the API Gateway over HTTP. The currently implemented business endpoint is:

| Method | Path                       | Outcome                                                                                          |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------ |
| `POST` | `/auth/attendees/register` | Creates an unverified attendee account after registration rate limiting and Identity validation. |

The Gateway also exposes:

- Scalar API reference at `/docs`;
- OpenAPI JSON at `/openapi.json`;
- OpenAPI YAML at `/openapi.yaml`;
- process liveness at `/health/live`.

The generated OpenAPI documents are the authoritative HTTP contract. See [services/api-gateway/API.md](services/api-gateway/API.md) for boundary behavior and error translation.

## Internal Contracts

Synchronous service commands and queries use gRPC. The current contract is `eventa.identity.v1.AttendeeIdentityService`, defined in [packages/grpc-contracts/proto/identity.proto](packages/grpc-contracts/proto/identity.proto).

Identity also exposes operational HTTP health endpoints; it does not expose business HTTP routes directly to clients. See [services/identity-service/API.md](services/identity-service/API.md).

Future event-bus and job-queue contracts will be documented when their producing and consuming slices are implemented.
