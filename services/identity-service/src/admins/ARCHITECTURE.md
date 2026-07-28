# Admin Authentication Architecture

Admin accounts live in Identity-owned `admin_accounts`; every row is inherently an admin. Reviewed SQL inserts only a canonical email. A provisioned row has no password, email-verification timestamp, or activation timestamp.

Registration performs one eligibility query against that table. Unknown and activated accounts are indistinguishable at the public boundary. Redis owns the protected email subject, OTP digest, five guesses, fifteen-minute OTP lifetime, replacement, resend cooldown, and ten-minute activation grant. Raw OTPs and activation credentials are never persisted.

OTP confirmation records `email_verified_at`. A confirmed OTP can be replayed during its original lifetime to recover a lost activation-cookie response. Password setup hashes the password and performs one conditional database update that sets `password_hash` and `activated_at`; the database constraint prevents a password without activation.

RabbitMQ carries expiring `admin.activation.v1` work to Notification. Queue publication is confirmed. A publication failure removes the new OTP and cooldown best-effort while preserving the generic registration response.

Activation grants cannot create sessions. Even if Redis cleanup fails after the database transition, the activated account prevents reuse from changing credentials.
