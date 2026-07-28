# Admin Authentication Architecture

Admin accounts live in Identity-owned `admin_accounts`; every row is inherently an admin. Reviewed SQL inserts only a canonical email. A provisioned row has no password, email-verification timestamp, or activation timestamp.

Registration performs one eligibility query against that table. Unknown and activated accounts are indistinguishable at the public boundary. Redis owns the protected email subject, OTP digest, five guesses, fifteen-minute OTP lifetime, replacement, resend cooldown, and ten-minute activation grant. Raw OTPs and activation credentials are never persisted.

OTP confirmation records `email_verified_at`. A confirmed OTP can be replayed during its original lifetime to recover a lost activation-cookie response. Password setup hashes the password and performs one conditional database update that sets `password_hash` and `activated_at`; the database constraint prevents a password without activation.

RabbitMQ carries expiring `admin.activation.v1` work to Notification. Queue publication is confirmed. A publication failure removes the new OTP and cooldown best-effort while preserving the generic registration response.

Activation grants cannot create sessions. Even if Redis cleanup fails after the database transition, the activated account prevents reuse from changing credentials.

Login loads the admin by canonical email. Only an activated row with a password proceeds to Argon2 verification, and only a matching password may issue a session. Unknown, unactivated, and wrong-password attempts share one public credential error.

Admin sessions use a separate protected Redis namespace and a separate host cookie. One atomic Redis operation uses Redis time, removes expired state, evicts the oldest session when three are already live, and creates a new session with one absolute seven-day lifetime. HMAC purpose prefixes separate admin activation, session-account, and session-token digests while using the existing admin-auth secret.

Redis is authoritative for session liveness. Session authentication reads only the bounded admin ID, session ID, and expiry from protected state. Current-account retrieval then queries `admin_accounts` because it must return account data and confirm the row remains fully activated. Logout atomically removes the session key and its account index entry.

Admin password recovery uses the account-neutral Redis claim/replay mechanism under an admin-only namespace and protects its subjects, codes, and completions with admin-specific HMAC prefixes. Forgot-password returns one response for every eligible or ineligible email. Reset hashes the replacement, revokes every admin session synchronously, conditionally updates the still-activated account, and records exact completion replay without extending the code lifetime.

`AdminAuthJobPublisher` groups activation and password-reset work while its RabbitMQ adapter keeps queue and job contracts separate.
