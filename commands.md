# Eventa Commands

Run commands from the repository root.

Create each service-owned `.env` and the Grafana `.env` before running these commands; commands never generate configuration or secrets.

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

Delete all Eventa database and observability volumes, then restart Eventa with fresh local state.

```bash
pnpm db:reset:all
```

## Local DB viewer

| Service  | Host        | Port    | Database          | Username          | Password                   |
| -------- | ----------- | ------- | ----------------- | ----------------- | -------------------------- |
| Identity | `localhost` | `55432` | `eventa_identity` | `eventa_identity` | `eventa_identity_password` |

## Local operations

Open the provisioned Eventa dashboard and explore metrics, traces, and logs in Grafana.

```bash
open http://localhost:3300
```

Open Alloy's component graph and collector diagnostics.

```bash
open http://localhost:51234
```
