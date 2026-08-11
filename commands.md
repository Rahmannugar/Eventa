# Eventa Commands

Run commands from the repository root.

Create each service-owned `.env` and the Grafana `.env` before running these commands; commands never generate configuration or secrets.

## Web app

Create `apps/eventa-app/.env` from its `.env.example`, then start the attendee and Admin Dashboard web experience directly on the host.

```bash
pnpm web:start
```

The web app runs at `http://localhost:5273`. It is not started through Docker Compose. Configure the API Gateway's `CLIENT_ORIGIN` as that same origin.

## Services

Build and start the complete Eventa stack, wait for migrations and event-bus initialization, then remove their completed containers. Compose concurrency is capped to protect local resources without omitting application, CDC, or observability services.

```bash
pnpm services:start
```

Start the same complete stack from existing images, wait for migrations and event-bus initialization, then remove their completed containers. Startup concurrency remains capped.

```bash
pnpm services:start:no-build
```

Stop Eventa without deleting database data.

```bash
pnpm services:stop
```

Show the current state of every Eventa container.

```bash
pnpm services:status
```

Follow logs from all Eventa services.

```bash
pnpm services:logs
```

## All services

Lint every service and shared package.

```bash
pnpm lint
```

Type-check every service and shared package.

```bash
pnpm typecheck
```

Run all unit tests.

```bash
pnpm test
```

Run all integration tests against real infrastructure dependencies.

```bash
pnpm test:integration
```

Run all unit and integration tests.

```bash
pnpm test:all
```

Build every service and shared package.

```bash
pnpm build
```

Format the repository.

```bash
pnpm format
```

Check formatting without changing files.

```bash
pnpm format:check
```

Run linting, type-checking, all tests, builds, and the formatting check.

```bash
pnpm verify
```

## gRPC contracts

Regenerate committed TypeScript contracts from the authoritative protobuf schemas.

```bash
pnpm proto:generate
```

Regenerate and fail if the existing generated output was stale.

```bash
pnpm proto:check
```

Compare current protobuf schemas with the Git baseline using Eventa's package-level compatibility policy.

```bash
pnpm proto:breaking
```

## All databases

Delete all Eventa database and observability volumes, then restart Eventa with fresh local state.

```bash
pnpm db:reset:all
```

## Local DB viewer

| Service      | Host        | Port    | Database              | Username              | Password                       |
| ------------ | ----------- | ------- | --------------------- | --------------------- | ------------------------------ |
| Identity     | `localhost` | `55432` | `eventa_identity`     | `eventa_identity`     | `eventa_identity_password`     |
| Event        | `localhost` | `57432` | `eventa_event`        | `eventa_event`        | `eventa_event_password`        |
| Notification | `localhost` | `56432` | `eventa_notification` | `eventa_notification` | `eventa_notification_password` |

## Local operations

Provision an inactive admin email in Identity. Repeating the command with the same email leaves the existing account unchanged.

```bash
pnpm admin:provision:identity admin@example.com
```

Open the shared RabbitMQ management interface.

```bash
open http://localhost:15673
```

Open the provisioned Eventa dashboard and explore metrics, traces, and logs in Grafana.

```bash
open http://localhost:3300
```

Before enabling Grafana alert email, set `GF_SMTP_PASSWORD`, a verified `GF_SMTP_FROM_ADDRESS`, and `GF_SMTP_ENABLED=true` in the ignored Grafana `.env`. The SMTP password is a separate Resend API key. Restart only Grafana after changing those values.

```bash
docker compose up -d --force-recreate observability-dashboard
```

Sign in as the configured Grafana administrator, then:

1. Open **Alerts & IRM → Contact points**.
2. Create an email contact point named **eventa-grafana-alerts**.
3. Enter the operator's recipient email in **Addresses**. This address belongs in Grafana, not the environment file.
4. Use **Test** to send one contact-point test without generating application failures.
5. Save the contact point after the email arrives.

Open Alloy's component graph and collector diagnostics.

```bash
open http://localhost:51234
```
