import { sql } from 'drizzle-orm';
import { check, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const ticketRevocationInbox = pgTable(
  'ticket_revocation_inbox',
  {
    messageId: uuid('message_id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    eventType: varchar('event_type', { length: 120 }).notNull(),
    receivedAt: timestamp('received_at', {
      mode: 'date',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'ticket_revocation_inbox_event_type_shape',
      sql`${table.eventType} = 'ticket.revoked.v1'`,
    ),
  ],
);
