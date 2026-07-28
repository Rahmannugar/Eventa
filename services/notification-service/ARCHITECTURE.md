# Notification Service Architecture

## Ownership

We own application-email delivery and durable delivery outcomes. We do not read Identity state or persist verification OTPs or recipient addresses. Identity remains authoritative for OTP validity and account verification.

We document the Notifications domain in [src/notifications/ARCHITECTURE.md](src/notifications/ARCHITECTURE.md).

## Service Composition

- We compose validated runtime configuration, health, database lifecycle, and the Notifications domain in `AppModule`.
- We keep one process-long RabbitMQ connection in `RabbitMQClient` and use purpose-specific consumer and confirm channels.
- We keep queue topology, acknowledgements, trace extraction, boundary validation, and retry publication in the verification and password-reset consumers.
- We coordinate claims, delivery, expiry, retries, and terminal outcomes in operation-specific delivery services.
- We keep verification and password-reset content in operation-specific senders so a provider change does not move product-email behavior.
- We isolate Resend in the replaceable `ResendClient`.

## Database and Migrations

We own `email_verification_deliveries` and `password_reset_deliveries`. Each job ID has one operation-specific row containing status, bounded attempt count, expiry, processing lease, retry timing, provider message ID, safe failure code, and terminal timestamps. We never persist recipient addresses, OTP values, or reset codes.

Migrations `0000_create_email_verification_deliveries` and `0001_create_password_reset_deliveries` are the deployment authority. We close runtime and migration connections through their owning lifecycle.

## Health and Shutdown

Liveness reports only process life. We check PostgreSQL and RabbitMQ for readiness because both are required to accept delivery work. We do not probe provider availability during readiness.

We stop accepting messages before closing RabbitMQ channels and the shared connection. We re-establish a closed consumer channel while the process remains active.

## Observability

We extract incoming trace context before the consumer span and inject the active context when publishing a retry. Structured events contain bounded job/message IDs, status, and safe error codes. We never include payloads, recipient addresses, OTPs, provider error text, or credentials.
