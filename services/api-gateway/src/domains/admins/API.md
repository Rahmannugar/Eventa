# Admin Authentication API

All routes require the exact configured admin-client `Origin`.

## Request activation

`POST /auth/admins/register` accepts an email and returns `202` with `{ "accepted": true }`. Unknown, activated, and eligible emails receive the same response. Only an inactive account inserted through Identity's reviewed provisioning SQL receives an email.

## Confirm activation

`POST /auth/admins/activation/confirm` accepts the provisioned email and a six-digit OTP. Success sets a host-only, HttpOnly, `SameSite=Lax` activation cookie scoped to `/auth/admins/activation` and returns `{ "activationReady": true }`. The cookie expires after ten minutes and is not a login session.

Invalid or expired OTPs return `400`. Validation failures return `422`; abuse controls return `429`; unavailable dependencies return `503`.

## Complete activation

`POST /auth/admins/activation/complete` accepts the first password and requires the activation cookie. Success atomically sets the password and activates the admin, clears the activation cookie, and returns `{ "activated": true }`.

Missing, expired, reused, or otherwise invalid activation state returns `400`. Activation never logs the admin in.
