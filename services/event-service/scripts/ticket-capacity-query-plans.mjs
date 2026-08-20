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

const rollback = new Error('ROLLBACK_QUERY_PLAN_EVIDENCE');
const seed = randomUUID();
const reports = [];
await ensureTestDatabase();
const database = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
await migrate(drizzle(database), {
  migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
});

function collectPlanDetails(node, details) {
  if (typeof node !== 'object' || node === null) return;
  if (typeof node['Node Type'] === 'string')
    details.nodes.add(node['Node Type']);
  if (typeof node['Index Name'] === 'string') {
    details.indexes.add(node['Index Name']);
  }
  for (const child of node.Plans ?? []) collectPlanDetails(child, details);
}

async function explain(transaction, name, statement, parameters = []) {
  const rows = await transaction.unsafe(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`,
    parameters,
  );
  const rawPlan = rows[0]?.['QUERY PLAN'];
  const parsed = typeof rawPlan === 'string' ? JSON.parse(rawPlan) : rawPlan;
  const report = parsed?.[0];
  if (report?.Plan === undefined)
    throw new Error(`No plan returned for ${name}`);

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
      INSERT INTO events (
        id, title, description, starts_at, ends_at, time_zone, status,
        version, created_by_admin_id, published_at
      )
      SELECT
        md5($1 || ':event:' || event_number)::uuid,
        'Query plan event ' || event_number,
        'Transient query-plan evidence.',
        now() + interval '30 days',
        now() + interval '30 days 2 hours',
        'Africa/Lagos',
        'published',
        1,
        md5($1 || ':admin')::uuid,
        now()
      FROM generate_series(1, 10) AS event_number
    `,
      [seed],
    );

    await transaction.unsafe(
      `
      INSERT INTO event_ticket_currencies (id, event_id, currency)
      SELECT
        md5($1 || ':currency:' || event_number)::uuid,
        md5($1 || ':event:' || event_number)::uuid,
        'NGN'
      FROM generate_series(1, 10) AS event_number
    `,
      [seed],
    );

    await transaction.unsafe(
      `
      INSERT INTO event_ticket_types (
        id, ticket_currency_id, name, price_minor, capacity,
        reserved_quantity, sold_quantity, sales_start_at, sales_end_at
      )
      SELECT
        md5($1 || ':type:' || type_number)::uuid,
        md5($1 || ':currency:' || (((type_number - 1) / 20) + 1))::uuid,
        'Ticket type ' || type_number,
        100000,
        1000000,
        CASE WHEN type_number = 1 THEN 10000 ELSE 500 END,
        0,
        now() - interval '1 day',
        now() + interval '29 days'
      FROM generate_series(1, 200) AS type_number
    `,
      [seed],
    );

    await transaction.unsafe(
      `
      INSERT INTO event_waitlist_entries (
        id, ticket_type_id, attendee_id, quantity, status, eligible_at,
        opportunity_expires_at, created_at, updated_at
      )
      SELECT
        md5($1 || ':waitlist:' || type_number || ':' || entry_number)::uuid,
        md5($1 || ':type:' || type_number)::uuid,
        md5($1 || ':attendee:' || type_number || ':' || entry_number)::uuid,
        1 + (entry_number % 4),
        CASE
          WHEN type_number = 1 AND entry_number > 9000 THEN 'eligible'
          ELSE 'waiting'
        END,
        CASE
          WHEN type_number = 1 AND entry_number > 9000
            THEN now() - interval '2 minutes'
          ELSE NULL
        END,
        CASE
          WHEN type_number = 1 AND entry_number BETWEEN 9001 AND 9500
            THEN now() + interval '14 minutes'
          WHEN type_number = 1 AND entry_number > 9500
            THEN now() - interval '1 minute'
          ELSE NULL
        END,
        now() - entry_number * interval '1 second',
        now()
      FROM generate_series(1, 200) AS type_number
      CROSS JOIN LATERAL generate_series(
        1,
        CASE WHEN type_number = 1 THEN 10000 ELSE 500 END
      ) AS entry_number
    `,
      [seed],
    );

    await transaction.unsafe(
      `
      INSERT INTO event_capacity_reservations (
        id, ticket_type_id, attendee_id, quantity, status, expires_at, created_at
      )
      SELECT
        md5($1 || ':reservation:' || type_number || ':' || reservation_number)::uuid,
        md5($1 || ':type:' || type_number)::uuid,
        md5($1 || ':buyer:' || type_number || ':' || reservation_number)::uuid,
        1,
        'active',
        CASE
          WHEN reservation_number <=
            CASE WHEN type_number = 1 THEN 5000 ELSE 250 END
            THEN now() - interval '1 minute'
          ELSE now() + interval '9 minutes'
        END,
        now() - interval '1 hour'
      FROM generate_series(1, 200) AS type_number
      CROSS JOIN LATERAL generate_series(
        1,
        CASE WHEN type_number = 1 THEN 10000 ELSE 500 END
      ) AS reservation_number
    `,
      [seed],
    );

    await transaction.unsafe(`
      ANALYZE events;
      ANALYZE event_ticket_currencies;
      ANALYZE event_ticket_types;
      ANALYZE event_waitlist_entries;
      ANALYZE event_capacity_reservations;
    `);

    const eventId =
      await transaction`SELECT md5(${seed} || ':event:1')::uuid AS id`;
    const ticketTypeId =
      await transaction`SELECT md5(${seed} || ':type:1')::uuid AS id`;
    const attendeeId =
      await transaction`SELECT md5(${seed} || ':attendee:1:100')::uuid AS id`;
    const selectedEventId = eventId[0].id;
    const selectedTicketTypeId = ticketTypeId[0].id;
    const selectedAttendeeId = attendeeId[0].id;
    const selectedEntry = await transaction.unsafe(
      `
        SELECT created_at, id
        FROM event_waitlist_entries
        WHERE ticket_type_id = $1 AND attendee_id = $2
        LIMIT 1
      `,
      [selectedTicketTypeId, selectedAttendeeId],
    );
    if (selectedEntry[0] === undefined) {
      throw new Error('Representative waitlist attendee was not created');
    }

    await explain(
      transaction,
      'attendee ticket availability',
      `
        SELECT t.id,
          COALESCE(w.waiting_count, 0)::int,
          COALESCE(w.eligible_quantity, 0)::int,
          aw.status,
          aw.opportunity_expires_at,
          COALESCE(ar.quantity, 0)::int,
          ar.expires_at
        FROM events e
        INNER JOIN event_ticket_currencies c ON c.event_id = e.id
        INNER JOIN event_ticket_types t
          ON t.ticket_currency_id = c.id AND t.retired_at IS NULL
        LEFT JOIN LATERAL (
          SELECT
            count(*) FILTER (WHERE entry.status = 'waiting')::int AS waiting_count,
            COALESCE(sum(entry.quantity) FILTER (
              WHERE entry.status = 'eligible'
                AND entry.opportunity_expires_at > now()
            ), 0)::int AS eligible_quantity
          FROM event_waitlist_entries entry
          WHERE entry.ticket_type_id = t.id
            AND (
              entry.status = 'waiting'
              OR (entry.status = 'eligible' AND entry.opportunity_expires_at > now())
            )
        ) w ON true
        LEFT JOIN LATERAL (
          SELECT entry.status, entry.opportunity_expires_at
          FROM event_waitlist_entries entry
          WHERE entry.ticket_type_id = t.id
            AND entry.attendee_id = $2
            AND (
              entry.status = 'waiting'
              OR (entry.status = 'eligible' AND entry.opportunity_expires_at > now())
            )
          LIMIT 1
        ) aw ON true
        LEFT JOIN LATERAL (
          SELECT sum(reservation.quantity)::int AS quantity,
            min(reservation.expires_at) AS expires_at
          FROM event_capacity_reservations reservation
          WHERE reservation.ticket_type_id = t.id
            AND reservation.attendee_id = $2
            AND reservation.status = 'active'
            AND reservation.expires_at > now()
        ) ar ON true
        WHERE e.id = $1 AND e.status = 'published' AND e.retired_at IS NULL
      `,
      [selectedEventId, selectedAttendeeId],
    );

    await explain(
      transaction,
      'active waitlist membership',
      `
        SELECT id, status, quantity
        FROM event_waitlist_entries
        WHERE ticket_type_id = $1
          AND attendee_id = $2
          AND status IN ('waiting', 'eligible')
        LIMIT 1
      `,
      [selectedTicketTypeId, selectedAttendeeId],
    );

    await explain(
      transaction,
      'waitlist FIFO position',
      `
        SELECT count(*)
        FROM event_waitlist_entries q
        WHERE q.ticket_type_id = $1
          AND (
            (q.status = 'eligible' AND q.opportunity_expires_at > now())
            OR (
              q.status = 'waiting'
              AND (q.created_at, q.id) < ($2::timestamptz, $3::uuid)
            )
          )
      `,
      [selectedTicketTypeId, selectedEntry[0].created_at, selectedEntry[0].id],
    );

    await explain(
      transaction,
      'promotion candidate sweep',
      `
        SELECT ticket_type.id
        FROM event_ticket_types ticket_type
        WHERE EXISTS (
          SELECT 1
          FROM event_waitlist_entries candidate
          WHERE candidate.ticket_type_id = ticket_type.id
            AND candidate.status = 'waiting'
          LIMIT 1
        ) OR EXISTS (
          SELECT 1
          FROM event_waitlist_entries candidate
          WHERE candidate.ticket_type_id = ticket_type.id
            AND candidate.status = 'eligible'
            AND candidate.opportunity_expires_at <= now()
          LIMIT 1
        )
        ORDER BY ticket_type.id
        LIMIT 100
      `,
    );

    await explain(
      transaction,
      'FIFO promotion batch',
      `
        SELECT id, quantity
        FROM event_waitlist_entries
        WHERE ticket_type_id = $1 AND status = 'waiting'
        ORDER BY created_at, id
        LIMIT 100
        FOR UPDATE SKIP LOCKED
      `,
      [selectedTicketTypeId],
    );

    await explain(
      transaction,
      'capacity update active demand',
      `
        SELECT max(quantity)
        FROM event_waitlist_entries
        WHERE ticket_type_id = $1 AND status IN ('waiting', 'eligible')
      `,
      [selectedTicketTypeId],
    );

    await explain(
      transaction,
      'reservation eligible demand',
      `
        SELECT coalesce(sum(quantity), 0)::int
        FROM event_waitlist_entries
        WHERE ticket_type_id = $1 AND status = 'eligible'
      `,
      [selectedTicketTypeId],
    );

    await explain(
      transaction,
      'expired eligibility cleanup',
      `
        UPDATE event_waitlist_entries
        SET status = 'expired', closed_at = now(), updated_at = now()
        WHERE ticket_type_id = $1
          AND status = 'eligible'
          AND opportunity_expires_at <= now()
      `,
      [selectedTicketTypeId],
    );

    await explain(
      transaction,
      'expired reservation cleanup',
      `
        UPDATE event_capacity_reservations
        SET status = 'expired', completed_at = now(), updated_at = now()
        WHERE ticket_type_id = $1
          AND status = 'active'
          AND expires_at <= now()
      `,
      [selectedTicketTypeId],
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
        events: 10,
        ticketTypes: 200,
        waitlistEntries: 109500,
        reservations: 109500,
        targetReservations: 10000,
      },
      plans: reports,
    },
    null,
    2,
  ),
);
