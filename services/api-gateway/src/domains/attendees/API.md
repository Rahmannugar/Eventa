# Gateway Attendees Domain API

## Register Attendee

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

Boundary rules:

- email must be valid and at most 320 characters;
- password must contain 12 through 128 characters;
- username must contain 3 through 30 letters, digits, or underscores;
- unknown request fields are rejected.

| Status | Meaning                                             |
| ------ | --------------------------------------------------- |
| `400`  | The request body is malformed and cannot be parsed. |
| `409`  | The email or username is unavailable.               |
| `422`  | One or more registration fields are invalid.        |
| `429`  | Too many registration attempts were made.           |
| `503`  | Registration is temporarily unavailable.            |

Errors use the Gateway-wide public envelope documented in the service [API.md](../../../API.md). Admitted and denied attempts include `RateLimit-Policy` and `RateLimit`; denied attempts also include `Retry-After`. Every response includes `x-request-id`.

The generated OpenAPI document is authoritative for exact HTTP schemas. This file explains the domain behavior without duplicating that machine-readable contract.
