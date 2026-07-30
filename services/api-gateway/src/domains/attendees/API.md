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

## Current Attendee Account

`GET /auth/attendees/me`

The Gateway reads `eventa_attendee_session`, resolves it through Identity-owned Redis state, and returns the verified active attendee account. Missing, malformed, expired, evicted, revoked, suspended-account, or deleted-account state returns `401 SESSION_INVALID`. The endpoint has independent client-IP and protected-session limits.

## Logout

`POST /auth/attendees/logout`

Logout rejects a present browser `Origin` unless it exactly matches the configured attendee client. It revokes only the presented session and then clears the matching host-only cookie. Success is `204`, including a request without a usable cookie. If Identity cannot confirm revocation, Gateway returns `503` and retains the cookie for retry.

Credentialed CORS permits only `CLIENT_ORIGIN`. Protected routes reject a different browser `Origin` with `403 UNTRUSTED_ORIGIN`; non-browser clients may omit the header.

## Delete Account

`POST /auth/attendees/delete-account`

The signed-in attendee supplies the current password. Success atomically marks the account deleted, records its lifecycle event, revokes every session, and clears the browser cookie with `204`. Deleted email and username values remain reserved. A missing or stale session returns `401`; an incorrect password or untrusted origin returns `403`; dedicated client-IP or protected-session limits return `429`; unavailable correctness dependencies return `503`.

## Confirm Email Verification

`POST /auth/attendees/email-verification/confirm`

The request contains a canonicalizable email address and a six-digit `otp`. Success returns `200 { "emailVerified": true }`. Invalid, expired, replaced, missing, and guess-exhausted OTPs all return `400 EMAIL_VERIFICATION_INVALID`; the response does not disclose account existence.

## Resend Email Verification

`POST /auth/attendees/email-verification/resend`

The request contains an email address. Accepted requests return `202 { "accepted": true }` for unknown, already-verified, and unverified accounts alike. Identity applies the 60-second per-email resend cooldown before account lookup.

Both endpoints apply independent Gateway token-bucket and hourly limits by client IP and canonical email before DTO validation. Validation returns `422`, endpoint or cooldown denial returns `429` with `Retry-After`, and unavailable dependencies return `503`. Responses include `RateLimit-Policy`, `RateLimit`, and `x-request-id`.

## Forgot Password

`POST /auth/attendees/forgot-password`

The request contains `email`. Accepted requests return `202 { "accepted": true }` for unknown, ineligible, and eligible attendees alike. Identity reserves the 60-second per-email request cooldown before account lookup and sends a six-digit reset code only for a verified, active, non-deleted attendee.

## Reset Password

`POST /auth/attendees/reset-password`

The request contains `email`, a six-digit `code`, and `newPassword`. Success returns `200 { "passwordReset": true }`. A successful reset revokes every attendee session before replacing the password. An exact replay of the same code and new password returns the same success without repeating those mutations. A different password cannot reuse a claimed or completed code.

Both endpoints reject a present browser `Origin` unless it exactly matches the configured attendee client and apply separate client-IP and protected-email abuse controls. Invalid fields return `422`; invalid, expired, replaced, or exhausted codes return `400 PASSWORD_RESET_INVALID`; route or per-email request cooldown denial returns `429`; unavailable rate-limit, Identity, reset-state, session-state, or delivery infrastructure returns `503`.
