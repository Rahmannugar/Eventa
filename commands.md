# Eventa Commands

Run commands from the repository root.

## Services

Build and start Eventa, run migrations, then remove the completed migration container.

```bash
pnpm services:start
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

## Identity Service

Run Identity migrations in a temporary container.

```bash
pnpm db:migrate:identity
```

Run Identity Service unit tests.

```bash
pnpm test:unit:identity
```

Start Identity PostgreSQL, create the test database when missing, and run integration tests.

```bash
pnpm test:integration:identity
```

Delete Identity database data and restart Eventa with a fresh Identity database.

```bash
pnpm db:reset:identity
```

## API Gateway

Run API Gateway unit tests.

```bash
pnpm test:unit:gateway
```

Start Redis and run API Gateway integration tests against it.

```bash
pnpm test:integration:gateway
```

## All databases

Delete every Eventa database volume and restart Eventa with fresh databases.

```bash
pnpm db:reset:all
```

## DBeaver

| Service | Host | Port | Database | Username | Password |
| --- | --- | --- | --- | --- | --- |
| Identity | `localhost` | `55432` | `eventa_identity` | `eventa_identity` | `eventa_identity_password` |
