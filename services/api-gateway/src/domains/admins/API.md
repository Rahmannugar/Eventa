# Admin Authentication API

## Request activation

`POST /auth/admins/register` accepts an email and returns `202` with `{ "accepted": true }`. Unknown, activated, and eligible emails receive the same response. Only an inactive account inserted through Identity's reviewed provisioning SQL receives an email.

## Activate

`POST /auth/admins/activate` accepts the provisioned email, six-digit OTP, and first password. Success verifies the OTP, sets the password, activates the account, and returns `{ "activated": true }`.

Invalid or expired OTPs return `400`. Validation failures return `422`; abuse controls return `429`; unavailable dependencies return `503`. Activation never logs the admin in.

## Login

`POST /auth/admins/login` accepts email and password. Only an activated admin with matching credentials receives `200` with admin ID and canonical email. Unknown, unactivated, and wrong-password attempts share `401 INVALID_CREDENTIALS`.

Success sets `eventa_admin_session` as a host-only HttpOnly, `SameSite=Lax`, `Path=/` cookie with Identity's fixed seven-day expiry. A fourth concurrent login silently replaces the oldest admin session. Login never refreshes another session.

## Current account

`GET /auth/admins/me` requires the admin session cookie and returns the activated admin ID and email. Missing, malformed, expired, revoked, or ineligible sessions return `401 ADMIN_SESSION_INVALID`.

## Logout

`POST /auth/admins/logout` revokes the presented Redis session before clearing the cookie and returns `204`. Missing or malformed cookies are cleared idempotently. Identity failure returns `503` and leaves a valid cookie intact.

Current-account and logout requests have separate IP and protected-session abuse controls. Authentication dependency failures return `503 ADMIN_AUTHENTICATION_UNAVAILABLE`.

## Password recovery

`POST /auth/admins/forgot-password` accepts an email and always returns `202` with `{ "accepted": true }` after its cooldown check. Unknown, inactive, and activated emails are indistinguishable; only an activated admin receives a code.

`POST /auth/admins/reset-password` accepts email, six-digit code, and a replacement password. Success returns `{ "passwordReset": true }` after Identity replaces the password and revokes every admin session. Invalid, expired, or mismatched completion returns `400 ADMIN_PASSWORD_RESET_INVALID`.

Both routes reject a present browser origin unless it exactly matches the configured admin client. They have separate IP plus protected-email abuse controls. Validation returns `422`, abuse controls return `429`, and dependency failure returns `503`.
