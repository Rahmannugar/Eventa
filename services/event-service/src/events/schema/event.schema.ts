import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
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
    description: text('description'),
    category: text('category'),
    startsAt: timestamp('starts_at', { mode: 'date', withTimezone: true }),
    endsAt: timestamp('ends_at', { mode: 'date', withTimezone: true }),
    timeZone: text('time_zone'),
    status: text('status')
      .$type<'draft' | 'published'>()
      .default('draft')
      .notNull(),
    version: integer('version').default(1).notNull(),
    createdByAdminId: uuid('created_by_admin_id').notNull(),
    publishedAt: timestamp('published_at', {
      mode: 'date',
      withTimezone: true,
    }),
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
    check(
      'events_description_length',
      sql`${table.description} IS NULL OR char_length(${table.description}) BETWEEN 1 AND 10000`,
    ),
    check(
      'events_description_normalized',
      sql`${table.description} IS NULL OR ${table.description} = btrim(${table.description})`,
    ),
    check(
      'events_category_normalized',
      sql`${table.category} IS NULL OR ${table.category} = btrim(${table.category})`,
    ),
    check(
      'events_category_length',
      sql`${table.category} IS NULL OR char_length(${table.category}) BETWEEN 1 AND 80`,
    ),
    check(
      'events_schedule_valid',
      sql`(${table.startsAt} IS NULL AND ${table.endsAt} IS NULL AND ${table.timeZone} IS NULL) OR (${table.startsAt} IS NOT NULL AND ${table.endsAt} IS NOT NULL AND ${table.timeZone} IS NOT NULL AND ${table.endsAt} > ${table.startsAt})`,
    ),
    check(
      'events_details_complete',
      sql`(${table.description} IS NULL AND ${table.category} IS NULL AND ${table.startsAt} IS NULL AND ${table.endsAt} IS NULL AND ${table.timeZone} IS NULL) OR (${table.description} IS NOT NULL AND ${table.category} IS NOT NULL AND ${table.startsAt} IS NOT NULL AND ${table.endsAt} IS NOT NULL AND ${table.timeZone} IS NOT NULL)`,
    ),
    check(
      'events_time_zone_length',
      sql`${table.timeZone} IS NULL OR char_length(${table.timeZone}) BETWEEN 1 AND 64`,
    ),
    check('events_version_positive', sql`${table.version} >= 1`),
    check(
      'events_status_allowed',
      sql`${table.status} IN ('draft', 'published')`,
    ),
    check(
      'events_published_at_shape',
      sql`(${table.status} = 'published') = (${table.publishedAt} IS NOT NULL)`,
    ),
  ],
);
