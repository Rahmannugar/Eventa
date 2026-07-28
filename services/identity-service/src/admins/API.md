# Admin Authentication API

Identity implements `eventa.identity.v1.AdminIdentityService`.

- `RegisterAdmin` accepts an email and always returns `accepted = true` after the universal cooldown check. It publishes activation email work only for a provisioned account without a password or activation timestamp.
- `ConfirmAdminActivation` accepts an email and six-digit OTP. Success records email verification idempotently and returns a ten-minute opaque activation credential for Gateway's HttpOnly cookie.
- `CompleteAdminActivation` accepts the activation credential and first password. Success hashes the password and atomically activates the account.
- `LoginAdmin` accepts email and password. Only an activated account with matching credentials receives its admin ID, canonical email, opaque session token, and fixed expiry.
- `AuthenticateAdminSession` resolves a live opaque session into bounded admin and session identity.
- `GetCurrentAdminAccount` returns the activated admin ID and email.
- `LogoutAdmin` revokes the presented session idempotently.

Invalid OTP or activation state uses `FAILED_PRECONDITION`. Redis unavailability uses `UNAVAILABLE`; registration cooldown uses `RESOURCE_EXHAUSTED` with retry metadata. DTO validation uses `INVALID_ARGUMENT`.

Unknown, unactivated, and wrong-password login attempts use the same `UNAUTHENTICATED` result. Session-state failure uses `UNAVAILABLE`.

Missing, malformed, expired, revoked, or no-longer-eligible sessions use `UNAUTHENTICATED`. Logout returns whether a live session was revoked; repeating it returns `revoked = false`.

Business operations are gRPC-only. `sql/provision-admin.sql` is the reviewed operator entry point for creating an inactive admin email.
