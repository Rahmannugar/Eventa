import { sql } from 'drizzle-orm';
import {
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import type { EVENT_CANCELLATION_EMAIL_JOB_TYPE } from '../constants/cancellation-email.constants';

type NotificationJobPayload = {
  deliveryId: string;
  type: typeof EVENT_CANCELLATION_EMAIL_JOB_TYPE;
};

export const notificationJobOutbox = pgTable(
  'notification_job_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    aggregateType: text('aggregate_type').notNull(),
    routingKey: text('routing_key').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<NotificationJobPayload>().notNull(),
    occurredAt: timestamp('occurred_at', {
      mode: 'date',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'notification_job_outbox_aggregate_type_valid',
      sql`${table.aggregateType} = 'eventa.notification.jobs'`,
    ),
    check(
      'notification_job_outbox_route_valid',
      sql.raw(
        "routing_key = 'eventa.notification.event-cancellation-email.v1'",
      ),
    ),
    check(
      'notification_job_outbox_event_type_valid',
      sql.raw("event_type = 'notification.event-cancellation-email.v1'"),
    ),
  ],
);
