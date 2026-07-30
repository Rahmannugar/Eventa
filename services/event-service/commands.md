# Event Service Commands

Run commands from the repository root.

```bash
pnpm --filter @eventa/event-service lint
pnpm --filter @eventa/event-service typecheck
pnpm --filter @eventa/event-service test:unit
pnpm test:integration:event
pnpm --filter @eventa/event-service build
pnpm db:migrate:event
pnpm db:reset:event
```

The integration suite requires the Event test database configured by `TEST_DATABASE_URL`. Database reset deletes the local Event database volume before restarting the stack.
