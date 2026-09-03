# Commerce Service

Commerce Service owns attendee orders, immutable ticket snapshots, and Stripe payment attempts. Its ticket-purchase workflow acquires temporary capacity from Event Service before preparing client payment confirmation.

## Local setup

Create `.env` from `.env.example`. Commerce requires its PostgreSQL database, a reachable Event Service gRPC endpoint, a Stripe secret key, and the signing secret for its Stripe webhook endpoint. Use test-mode Stripe values for local development. A Stripe CLI signing secret and a Dashboard-managed endpoint signing secret are different values; use the secret issued for the endpoint that sends the request. The configured Stripe request timeout and retry count remain inside the Gateway's outer request budget. Docker Compose runs the database migration before starting the service.

The service exposes:

- gRPC on port `50053`;
- Stripe webhooks at `http://localhost:3008/webhooks/stripe`;
- liveness at `http://localhost:3008/health/live`;
- database-backed readiness at `http://localhost:3008/health/ready`.

Configure the Stripe endpoint to send only `payment_intent.created`, `payment_intent.requires_action`, `payment_intent.processing`, `payment_intent.payment_failed`, `payment_intent.succeeded`, and `payment_intent.canceled`. A tunnel forwards its public HTTPS URL to Commerce port `3008`; the webhook does not pass through the API Gateway.

## Commands

Run these commands from the repository root.

```bash
pnpm --filter @eventa/commerce-service lint
pnpm --filter @eventa/commerce-service typecheck
pnpm --filter @eventa/commerce-service test:unit
pnpm test:integration:commerce
pnpm --filter @eventa/commerce-service build
pnpm db:migrate:commerce
```

The integration suite requires `TEST_DATABASE_URL` to name a database ending in `_test`. It creates that database when needed, migrates it, and clears only Commerce-owned test tables between cases.

### Performance

Measure the idempotency lookup, order retrieval, pending-reservation recovery scan, and locked quote-transition lookup against representative PostgreSQL data.

```bash
pnpm --filter @eventa/commerce-service performance:order-plans
```

The command starts Commerce PostgreSQL, applies test migrations, and creates 50,000 orders and 45,000 immutable order items inside a rollback-only transaction. It reports execution time, buffer use, plan nodes, and selected indexes without retaining generated records.

See [API.md](API.md) for the contract map and [ARCHITECTURE.md](ARCHITECTURE.md) for ownership, state, and recovery behavior.
