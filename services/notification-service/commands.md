# Notification Service Commands

Run commands from the repository root.

## Database

Run Notification migrations in a temporary container.

```bash
pnpm db:migrate:notification
```

## Validation

Run Notification Service unit tests.

```bash
pnpm test:unit:notification
```

Start Notification PostgreSQL and RabbitMQ, create the isolated test database when missing, and run the real delivery integration suite.

```bash
pnpm test:integration:notification
```

Run the service-owned type check.

```bash
pnpm --filter @eventa/notification-service typecheck
```

Build the service.

```bash
pnpm --filter @eventa/notification-service build
```

## Local DB viewer

| Host        | Port    | Database              | Username              | Password                       |
| ----------- | ------- | --------------------- | --------------------- | ------------------------------ |
| `localhost` | `56432` | `eventa_notification` | `eventa_notification` | `eventa_notification_password` |
