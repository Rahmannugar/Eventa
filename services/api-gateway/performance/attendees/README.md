# Attendee Verification Performance Validation

The attendee domain's k6 scenarios run one controlled workflow at a time against the local stack. They validate correctness and observed latency; they are not load, stress, soak, or capacity tests.

Start Eventa, then start Notification's local read-only delivery observer:

```bash
pnpm --filter @eventa/notification-service performance:notifications:observe-deliveries
```

The observer binds only to `127.0.0.1`, reads Notification's durable delivery table, and returns no email or OTP values.

The attendee commands run the pinned `grafana/k6:2.1.0` image. They do not require a host k6 installation.

## Registration and initial delivery

Use a fresh attendee identity that can receive the real verification email:

```bash
EVENTA_ATTENDEE_EMAIL='attendee@onboarding.dev' \
EVENTA_ATTENDEE_USERNAME='event_fan' \
EVENTA_ATTENDEE_PASSWORD='a-secure-password' \
pnpm --filter @eventa/api-gateway performance:attendees:registration
```

The scenario performs one registration and waits for the corresponding new Notification delivery to become durably `delivered`.

## Resend and replacement delivery

Wait for the 60-second cooldown if this attendee was already resent:

```bash
EVENTA_ATTENDEE_EMAIL='attendee@onboarding.dev' \
pnpm --filter @eventa/api-gateway performance:attendees:resend
```

The scenario performs one resend and waits for its replacement delivery to become durably `delivered`.

## Confirmation and exact replay

Use the newest OTP received by the attendee:

```bash
EVENTA_ATTENDEE_EMAIL='attendee@onboarding.dev' \
EVENTA_ATTENDEE_OTP='123456' \
pnpm --filter @eventa/api-gateway performance:attendees:confirmation
```

The scenario confirms once and immediately repeats the exact confirmation to validate the idempotent replay path.

`EVENTA_BASE_URL` defaults to `http://127.0.0.1:3004`, `EVENTA_DELIVERY_OBSERVER_URL` defaults to `http://127.0.0.1:3016`, and `EVENTA_DELIVERY_TIMEOUT_MS` defaults to 15 seconds.

Run the scenarios individually while watching the application, Identity, and Notification dashboards plus the matching traces. Do not run the registration or resend scenarios concurrently; the observer intentionally correlates the next new durable delivery in this dedicated single-workflow validation.
