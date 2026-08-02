# Eventa API

## Public API Map

Clients communicate with Eventa through the API Gateway over HTTP.

| Method | Path                                         | Outcome                                                                                          |
| ------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `POST` | `/auth/attendees/register`                   | Creates an unverified attendee account after registration rate limiting and Identity validation. |
| `POST` | `/auth/admins/register`                      | Generically accepts an activation request for a SQL-provisioned admin.                           |
| `POST` | `/auth/admins/activate`                      | Verifies the activation OTP, sets the first password, and activates the admin.                   |
| `POST` | `/auth/admins/login`                         | Signs in an activated admin and sets a server-backed seven-day session cookie.                   |
| `GET`  | `/auth/admins/me`                            | Returns the activated account for a live admin session.                                          |
| `POST` | `/auth/admins/logout`                        | Revokes the current admin session before clearing its cookie.                                    |
| `POST` | `/auth/admins/forgot-password`               | Generically accepts an admin password-reset email request.                                       |
| `POST` | `/auth/admins/reset-password`                | Replaces an activated admin password and revokes every admin session.                            |
| `POST` | `/auth/attendees/email-verification/confirm` | Confirms email ownership with a valid six-digit OTP.                                             |
| `POST` | `/auth/attendees/email-verification/resend`  | Accepts an enumeration-resistant request for a replacement OTP email.                            |
| `POST` | `/admin/events`                              | Creates a draft event.                                                                           |
| `GET`  | `/admin/events/:eventId`                     | Returns an event to any authenticated admin.                                                     |
| `PUT`  | `/admin/events/:eventId`                     | Replaces editable draft details when the supplied version is current.                            |

The Gateway also exposes:

- Scalar API reference at `/docs`;
- OpenAPI JSON at `/openapi.json`;
- OpenAPI YAML at `/openapi.yaml`;
- process liveness at `/health/live`.

This root file remains a compact map as Eventa grows; it does not duplicate every endpoint, example, or response. The generated OpenAPI documents are the authoritative public HTTP contract. See [services/api-gateway/API.md](services/api-gateway/API.md) for Gateway boundary behavior and error translation.

## Internal Contracts

Synchronous service commands and queries use the attendee and admin gRPC services in `eventa.identity.v1` and the Event service in `eventa.event.v1`.

The protobuf schemas are authoritative. Buf validates and generates the TypeScript message, client, controller, package, and service declarations exported by `@eventa/grpc-contracts`; consumers do not hand-maintain protobuf-derived TypeScript shapes.

Identity also exposes operational HTTP health endpoints; it does not expose business HTTP routes directly to clients. See [services/identity-service/API.md](services/identity-service/API.md).

Event Service exposes draft creation, optimistic draft updates, and admin event retrieval over gRPC plus operational HTTP health endpoints. See [services/event-service/API.md](services/event-service/API.md).

Identity publishes versioned attendee verification, attendee password-reset, admin-activation, and admin password-reset email jobs for Notification. `@eventa/messaging-contracts` owns the contracts. Notification exposes only operational HTTP health endpoints. See [services/notification-service/API.md](services/notification-service/API.md).

Each service documents its owned internal surface in its own `API.md`.
