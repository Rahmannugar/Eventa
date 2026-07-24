# Identity Service Commands

Run commands from the repository root.

## Database

Run Identity migrations in a temporary container.

```bash
pnpm db:migrate:identity
```

Delete Identity database data and restart Eventa with a fresh Identity database.

```bash
pnpm db:reset:identity
```

## Validation

Run Identity Service unit tests.

```bash
pnpm test:unit:identity
```

Start Identity PostgreSQL, Redis, and RabbitMQ, create the test database when missing, and run the integration suite.

```bash
pnpm test:integration:identity
```

Run the service-owned type check.

```bash
pnpm --filter @eventa/identity-service typecheck
```

Build the service.

```bash
pnpm --filter @eventa/identity-service build
```

## Local DB viewer

| Host        | Port    | Database          | Username          | Password                   |
| ----------- | ------- | ----------------- | ----------------- | -------------------------- |
| `localhost` | `55432` | `eventa_identity` | `eventa_identity` | `eventa_identity_password` |
