import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { events } from './event.schema';

export const eventCategories = pgTable(
  'event_categories',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.category] }),
    uniqueIndex('event_categories_event_lower_category_unique').on(
      table.eventId,
      sql`lower(${table.category})`,
    ),
    index('event_categories_category_index').on(table.category),
    check(
      'event_categories_normalized',
      sql`${table.category} = btrim(${table.category})`,
    ),
    check(
      'event_categories_length',
      sql`char_length(${table.category}) BETWEEN 1 AND 80`,
    ),
  ],
);
