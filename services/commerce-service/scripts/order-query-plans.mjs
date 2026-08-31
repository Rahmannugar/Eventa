import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.trim() === '') {
  throw new Error('TEST_DATABASE_URL is required');
}

const databaseName = new URL(databaseUrl).pathname.slice(1);
if (!/^[a-z][a-z0-9_]*_test$/.test(databaseName)) {
  throw new Error('TEST_DATABASE_URL must target a database ending in _test');
}

async function ensureTestDatabase() {
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), {
    max: 1,
    onnotice: () => undefined,
  });
  try {
    const rows = await admin`
      SELECT EXISTS (
        SELECT 1 FROM pg_database WHERE datname = ${databaseName}
      ) AS exists
    `;
    if (rows[0]?.exists !== true) {
      await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    }
  } catch (error) {
    if (error?.code !== '42P04') throw error;
  } finally {
    await admin.end();
  }
}

function collectPlanDetails(node, details) {
  if (typeof node !== 'object' || node === null) return;
  if (typeof node['Node Type'] === 'string') {
    details.nodes.add(node['Node Type']);
  }
  if (typeof node['Index Name'] === 'string') {
    details.indexes.add(node['Index Name']);
  }
  for (const child of node.Plans ?? []) collectPlanDetails(child, details);
}

const rollback = new Error('ROLLBACK_QUERY_PLAN_EVIDENCE');
const reports = [];
const seed = randomUUID();

await ensureTestDatabase();
const database = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
await migrate(drizzle(database), {
  migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
});

async function explain(transaction, name, statement, parameters = []) {
  const rows = await transaction.unsafe(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`,
    parameters,
  );
  const rawPlan = rows[0]?.['QUERY PLAN'];
  const parsed = typeof rawPlan === 'string' ? JSON.parse(rawPlan) : rawPlan;
  const report = parsed?.[0];
  if (report?.Plan === undefined) {
    throw new Error(`No plan returned for ${name}`);
  }

  const details = { indexes: new Set(), nodes: new Set() };
  collectPlanDetails(report.Plan, details);
  reports.push({
    name,
    executionMs: report['Execution Time'],
    planningMs: report['Planning Time'],
    returnedRows: report.Plan['Actual Rows'],
    indexes: [...details.indexes].sort(),
    nodes: [...details.nodes].sort(),
    sharedHitBlocks: report.Plan['Shared Hit Blocks'] ?? 0,
    sharedReadBlocks: report.Plan['Shared Read Blocks'] ?? 0,
  });
}

try {
  await database.begin(async (transaction) => {
    await transaction.unsafe(
      `
        INSERT INTO commerce_orders (
          id, attendee_id, idempotency_key, event_id, ticket_type_id,
          requested_quantity, status, currency, total_minor,
          reservation_expires_at, created_at, updated_at
        )
        SELECT
          md5($1 || ':order:' || order_number)::uuid,
          md5($1 || ':attendee:' || (order_number % 5000))::uuid,
          md5($1 || ':idempotency:' || order_number)::uuid,
          md5($1 || ':event:' || (order_number % 100))::uuid,
          md5($1 || ':ticket-type:' || (order_number % 1000))::uuid,
          1 + (order_number % 4),
          CASE
            WHEN order_number % 10 = 0
              THEN 'pending_reservation'::commerce_order_status
            ELSE 'pending_payment'::commerce_order_status
          END,
          CASE WHEN order_number % 10 = 0 THEN NULL ELSE 'NGN' END,
          CASE
            WHEN order_number % 10 = 0 THEN NULL
            ELSE (1 + (order_number % 4)) * 2500
          END,
          CASE
            WHEN order_number % 10 = 0 THEN NULL
            ELSE now() + interval '10 minutes'
          END,
          now() - order_number * interval '1 second',
          now() - order_number * interval '1 second'
        FROM generate_series(1, 50000) AS order_number
      `,
      [seed],
    );

    await transaction.unsafe(
      `
        INSERT INTO commerce_order_items (
          order_id, ticket_name, quantity, unit_price_minor, line_total_minor
        )
        SELECT
          id,
          'Standard',
          requested_quantity,
          2500,
          requested_quantity * 2500
        FROM commerce_orders
        WHERE status = 'pending_payment'
          AND id IN (
            SELECT md5($1 || ':order:' || order_number)::uuid
            FROM generate_series(1, 50000) AS order_number
          )
      `,
      [seed],
    );

    await transaction.unsafe(`
      ANALYZE commerce_orders;
      ANALYZE commerce_order_items;
    `);

    const selected = await transaction.unsafe(
      `
        SELECT
          md5($1 || ':order:20')::uuid AS order_id,
          md5($1 || ':attendee:20')::uuid AS attendee_id,
          md5($1 || ':idempotency:20')::uuid AS idempotency_key
      `,
      [seed],
    );
    const target = selected[0];
    if (target === undefined)
      throw new Error('Representative order is missing');

    await explain(
      transaction,
      'idempotency lookup',
      `
        SELECT id, status
        FROM commerce_orders
        WHERE attendee_id = $1 AND idempotency_key = $2
        LIMIT 1
      `,
      [target.attendee_id, target.idempotency_key],
    );

    await explain(
      transaction,
      'order retrieval',
      `
        SELECT id, attendee_id, status, currency, total_minor,
          reservation_expires_at, created_at, updated_at
        FROM commerce_orders
        WHERE id = $1
        LIMIT 1
      `,
      [target.order_id],
    );

    await explain(
      transaction,
      'pending reservation recovery batch',
      `
        SELECT id, attendee_id, event_id, ticket_type_id, requested_quantity
        FROM commerce_orders
        WHERE status = 'pending_reservation'
          AND (updated_at, id) < (now(), 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)
        ORDER BY updated_at, id
        LIMIT 100
        FOR UPDATE SKIP LOCKED
      `,
    );

    await explain(
      transaction,
      'locked quote transition lookup',
      `
        SELECT id, status
        FROM commerce_orders
        WHERE id = $1
        LIMIT 1
        FOR UPDATE
      `,
      [target.order_id],
    );

    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await database.end();
}

console.log(
  JSON.stringify(
    {
      dataset: {
        orders: 50000,
        orderItems: 45000,
        pendingReservations: 5000,
      },
      plans: reports,
    },
    null,
    2,
  ),
);
