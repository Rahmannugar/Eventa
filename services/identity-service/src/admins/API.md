# Admin Authentication API

Identity implements `eventa.identity.v1.AdminIdentityService`.

- `RegisterAdmin` accepts an email and always returns `accepted = true` after the universal cooldown check. It publishes activation email work only for a provisioned account without a password or activation timestamp.
- `ConfirmAdminActivation` accepts an email and six-digit OTP. Success records email verification idempotently and returns a ten-minute opaque activation credential for Gateway's HttpOnly cookie.
- `CompleteAdminActivation` accepts the activation credential and first password. Success hashes the password and atomically activates the account.

Invalid OTP or activation state uses `FAILED_PRECONDITION`. Redis unavailability uses `UNAVAILABLE`; registration cooldown uses `RESOURCE_EXHAUSTED` with retry metadata. DTO validation uses `INVALID_ARGUMENT`.

Business operations are gRPC-only. `sql/provision-admin.sql` is the reviewed operator entry point for creating an inactive admin email.
