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
- password must contain 8 through 128 characters;
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

## Login

`POST /auth/attendees/login`

The request contains `email` and `password`. A successful `200` response contains the attendee ID, canonical email and username, `emailVerified: true`, and `status: "active"`. The session token is returned only as the host-only `eventa_attendee_session` cookie with `HttpOnly`, `SameSite=Lax`, `Path=/`, the Identity-provided absolute expiry, and `Secure` when the public API uses HTTPS.

Incorrect credentials return `401`. After a correct password, unverified, suspended, and deleted accounts return distinct `403` errors. Invalid fields return `422`; abuse-control denial returns `429`; unavailable rate-limit, Identity, or session state returns `503`. Login applies independent client-IP and canonical-email limits.

## Confirm Email Verification

`POST /auth/attendees/email-verification/confirm`

The request contains a canonicalizable email address and a six-digit `otp`. Success returns `200 { "emailVerified": true }`. Invalid, expired, replaced, missing, and guess-exhausted OTPs all return `400 EMAIL_VERIFICATION_INVALID`; the response does not disclose account existence.

## Resend Email Verification

`POST /auth/attendees/email-verification/resend`

The request contains an email address. Accepted requests return `202 { "accepted": true }` for unknown, already-verified, and unverified accounts alike. Identity applies the 60-second per-email resend cooldown before account lookup.

Both endpoints apply independent Gateway token-bucket and hourly limits by client IP and canonical email before DTO validation. Validation returns `422`, endpoint or cooldown denial returns `429` with `Retry-After`, and unavailable dependencies return `503`. Responses include `RateLimit-Policy`, `RateLimit`, and `x-request-id`.
