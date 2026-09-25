import { pgTable, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

export const cancellationEmailDeliveries = pgTable(
  'cancellation_email_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id').notNull(),
    attendeeId: uuid('attendee_id').notNull(),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique('cancellation_email_deliveries_event_attendee_unique').on(
      table.eventId,
      table.attendeeId,
    ),
  ],
);
