# API Gateway API

## Attendee Registration

`POST /auth/attendees/register`

Request:

```json
{
  "email": "attendee@example.com",
  "password": "a-secure-password",
  "username": "event_fan"
}
```

Successful response: `201 Created`

```json
{
  "attendeeId": "f3c1ab8f-b445-41f5-9d87-c434ae7fe223",
  "email": "attendee@example.com",
  "username": "event_fan",
  "emailVerified": false
}
```

Boundary requirements:

- email must be valid and at most 320 characters;
- password must contain 12 through 128 characters;
- username must contain 3 through 30 letters, digits, or underscores;
- unknown request fields are rejected.

Possible outcomes:

| Status | Meaning                                                                  |
| ------ | ------------------------------------------------------------------------ |
| `400`  | HTTP or Identity boundary validation rejected the command.               |
| `409`  | The canonical email or username already exists.                          |
| `429`  | A registration rate-limit rule denied the attempt.                       |
| `503`  | Redis could not make the admission decision or Identity was unavailable. |

Admitted and denied attempts include `RateLimit-Policy` and `RateLimit`. Denied attempts also include `Retry-After`. Every response includes an `x-request-id`; a valid incoming value is preserved, otherwise the Gateway creates one.

## Operational and Documentation Routes

| Method | Path            | Purpose                                |
| ------ | --------------- | -------------------------------------- |
| `GET`  | `/health/live`  | Confirms the Gateway process is alive. |
| `GET`  | `/docs`         | Scalar interactive API reference.      |
| `GET`  | `/openapi.json` | Importable OpenAPI JSON contract.      |
| `GET`  | `/openapi.yaml` | Importable OpenAPI YAML contract.      |

The generated OpenAPI document is authoritative for the exact HTTP schema. Swagger UI is disabled; Nest Swagger generates the contract and Scalar renders it.
