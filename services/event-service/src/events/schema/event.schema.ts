import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const events = pgTable(
  'events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: text('title').notNull(),
    status: text('status').$type<'draft'>().default('draft').notNull(),
    createdByAdminId: uuid('created_by_admin_id').notNull(),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', {
      mode: 'date',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('events_status_created_at_index').on(table.status, table.createdAt),
    check(
      'events_title_normalized',
      sql`${table.title} = btrim(${table.title})`,
    ),
    check(
      'events_title_length',
      sql`char_length(${table.title}) BETWEEN 1 AND 160`,
    ),
    check('events_status_allowed', sql`${table.status} IN ('draft')`),
  ],
);
