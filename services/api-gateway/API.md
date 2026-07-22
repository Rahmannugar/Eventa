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

| Status | Meaning                                                         |
| ------ | --------------------------------------------------------------- |
| `400`  | The request body is malformed and cannot be parsed.             |
| `405`  | The registration path was called with a method other than POST. |
| `409`  | The email or username is unavailable.                           |
| `422`  | One or more registration fields are invalid.                    |
| `429`  | Too many registration attempts were made.                       |
| `503`  | Registration is temporarily unavailable.                        |

Errors use one public shape:

```json
{
  "statusCode": 422,
  "code": "VALIDATION_FAILED",
  "message": "Check the highlighted fields and try again.",
  "errors": [
    {
      "field": "password",
      "code": "TOO_SHORT",
      "message": "Password must be at least 12 characters."
    }
  ]
}
```

`errors` is present only when the client can correct specific fields. Internal dependency names and error details are never exposed in the public response.

Admitted and denied attempts include `RateLimit-Policy` and `RateLimit`. Denied attempts also include `Retry-After`. A `405` response includes `Allow: POST`. Every response includes an `x-request-id`; a valid incoming value is preserved, otherwise the Gateway creates one and forwards it to Identity over gRPC metadata.

## Operational and Documentation Routes

| Method | Path            | Purpose                                |
| ------ | --------------- | -------------------------------------- |
| `GET`  | `/health/live`  | Confirms the Gateway process is alive. |
| `GET`  | `/docs`         | Scalar interactive API reference.      |
| `GET`  | `/openapi.json` | Importable OpenAPI JSON contract.      |
| `GET`  | `/openapi.yaml` | Importable OpenAPI YAML contract.      |

The generated OpenAPI document is authoritative for the exact HTTP schema. Swagger UI is disabled; Nest Swagger generates the contract and Scalar renders it.
