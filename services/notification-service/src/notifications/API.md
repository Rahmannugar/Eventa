# Notifications Domain API

## Attendee Email Verification Job

We consume `attendee.email-verification.v1` from the durable quorum queue `eventa.notification.attendee-email-verification.v1`. `@eventa/messaging-contracts` exports the authoritative TypeScript contract.

The versioned JSON payload contains:

- `jobId`: UUID v4 and provider idempotency key;
- `recipientEmail`: delivery address, used only in memory and in the provider request;
- `otp`: exactly six digits, used only in memory and in email content;
- `expiresAt`: canonical absolute ISO timestamp;
- `type`: exact versioned job type.

AMQP `messageId`, message `type`, and content type must agree with the payload. We reject unknown fields, malformed JSON, invalid values, and mismatched properties at the queue boundary. A valid property job ID lets us record `rejected` without persisting the payload.

We use no terminal dead-letter queue. We acknowledge invalid, expired, delivered, and terminally failed messages after establishing their durable outcome. We acknowledge retryable work only after RabbitMQ confirms the retry copy. Infrastructure failures leave the active delivery unacknowledged and do not consume a provider attempt.
