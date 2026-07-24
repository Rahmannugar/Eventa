# API Gateway Commands

Run commands from the repository root.

## Validation

Run API Gateway unit tests.

```bash
pnpm test:unit:gateway
```

Start the Gateway-owned Redis instance and run the integration suite.

```bash
pnpm test:integration:gateway
```

Run the service-owned type check.

```bash
pnpm --filter @eventa/api-gateway typecheck
```

Build the service.

```bash
pnpm --filter @eventa/api-gateway build
```

## Local runtime

Run the complete local registration path.

```bash
pnpm services:start
```
