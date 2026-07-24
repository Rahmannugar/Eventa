# Eventa Notification Service

Notification owns application-email delivery and durable delivery history. It consumes attendee email-verification jobs from RabbitMQ and sends them through the configured email provider.

## Runtime

- HTTP health port: configured by `HEALTH_PORT`; local Compose publishes `3006`.
- PostgreSQL: configured by `DATABASE_URL`; local Compose publishes the Notification-owned database on host port `56432`.
- RabbitMQ: configured by `RABBITMQ_URL`; local Compose publishes AMQP on host port `5673`.
- Product-email provider: Resend credentials and sender identity are configured by `RESEND_API_KEY` and `RESEND_FROM`.
- OTLP telemetry destination: configured by `OTEL_EXPORTER_OTLP_ENDPOINT`.

Create the ignored `.env` deliberately from `.env.example`. The committed example uses Resend's `onboarding@resend.dev` learning sender; production uses the verified Eventa sender identity.

## Commands

See [commands.md](commands.md) for Notification-owned database and validation commands.

The integration suite requires `TEST_DATABASE_URL` and `TEST_RABBITMQ_URL`. It refuses a test database without an `_test` suffix and creates the isolated database when missing.

## Further Documentation

- [API.md](API.md): job-queue and health contracts.
- [ARCHITECTURE.md](ARCHITECTURE.md): service composition, persistence, delivery, and recovery.
- [commands.md](commands.md): service-owned database and validation commands.
- [Notifications API](src/notifications/API.md) and [architecture](src/notifications/ARCHITECTURE.md): domain-owned payload, state, retry, expiry, and provider behavior.
