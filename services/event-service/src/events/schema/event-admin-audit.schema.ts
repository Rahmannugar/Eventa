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

import { events } from './event.schema';

export const eventAdminAuditLog = pgTable(
  'event_admin_audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'restrict' }),
    actorAdminId: uuid('actor_admin_id').notNull(),
    action: text('action')
      .$type<
        | 'event.created'
        | 'event.updated'
        | 'event.media_upload_requested'
        | 'event.media_attached'
      >()
      .notNull(),
    eventVersion: integer('event_version').notNull(),
    requestId: text('request_id').notNull(),
    occurredAt: timestamp('occurred_at', {
      mode: 'date',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('event_admin_audit_event_time_index').on(
      table.eventId,
      table.occurredAt,
    ),
    check(
      'event_admin_audit_action_allowed',
      sql`${table.action} IN ('event.created', 'event.updated', 'event.media_upload_requested', 'event.media_attached')`,
    ),
    check(
      'event_admin_audit_version_positive',
      sql`${table.eventVersion} >= 1`,
    ),
    check(
      'event_admin_audit_request_id_length',
      sql`char_length(${table.requestId}) BETWEEN 1 AND 128`,
    ),
  ],
);
