# Notifications Domain Architecture

## Runtime Flow

1. We receive a persistent message in `EmailVerificationJobConsumer` from the main quorum queue through RabbitMQ's default direct exchange.
2. We validate byte size, JSON shape, version, AMQP properties, UUID, email, six-digit OTP, and canonical expiry before application logic.
3. We insert or lock the Notification-owned job row in `EmailVerificationDeliveryRepository.claim()`. A 30-second claim lease permits one provider attempt and recovery after a process crash.
4. We acknowledge terminal duplicates without provider work and record expired work as `expired`.
5. We pass valid claimed work from `EmailVerificationDeliveryService` to `EmailVerificationEmailSender`.
6. We keep subject and HTML/text content in the sender and pass a provider-neutral request through `EmailDeliveryProvider`.
7. We apply Resend authentication, a bounded HTTP timeout, response translation, and job-ID idempotency in `ResendClient`.
8. We record provider acceptance as `delivered`, including the provider message ID, before acknowledgement.

## Retry and Recovery

We allow at most three provider attempts. We record retryable first and second failures as `retry_scheduled` and send them through 5-second and 30-second quorum delay queues. These queues use RabbitMQ TTL/dead-letter transfer only to return work through the default exchange; they are not terminal DLQs. We use at-least-once transfer and publisher-reject overflow so RabbitMQ retains the source copy until the main queue confirms it.

We disable RabbitMQ's delivery limit on the main queue because this flow intentionally has no terminal DLQ. We keep infrastructure failures unacknowledged and retry them in place; shutdown or connection loss returns them to RabbitMQ. The durable attempt count and job expiry bound provider work independently.

The payload's `expiresAt` is authoritative. We do not set a broker TTL on the main message, so worker downtime cannot delete it before we record `expired`. We do not schedule a retry beyond the job deadline.

We publish retries through a confirm channel and acknowledge the active message only after RabbitMQ confirms its retry copy. If publication or persistence fails, the original remains recoverable. Every provider call uses the same job ID; Resend retains idempotency keys for 24 hours.

We record permanent provider rejection or the third failed attempt as `failed` before acknowledgement. A replacement OTP creates a new job ID through the existing resend flow. We never replay stale verification email from a DLQ.

## Data and Privacy

We store only job type/ID, delivery status, attempt count, expiry, claim/retry timestamps, provider message ID, safe failure code, and lifecycle timestamps in `email_verification_deliveries`. We have no email or OTP column.

We use job/message IDs and bounded outcome codes in logs, traces, metrics, and alerts. We never include recipient addresses, OTPs, raw message bodies, provider response text, API keys, or arbitrary errors.
