import { sql } from 'drizzle-orm';
import {
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import type {
  EVENT_MEDIA_OBJECT_DELETION_JOB_TYPE,
  EVENT_MEDIA_VERIFICATION_JOB_TYPE,
} from '../constants/event-media.constants';

type EventJobPayload =
  | { type: typeof EVENT_MEDIA_VERIFICATION_JOB_TYPE; uploadId: string }
  | {
      type: typeof EVENT_MEDIA_OBJECT_DELETION_JOB_TYPE;
      deletionId: string;
    };

export const eventJobOutbox = pgTable(
  'event_job_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    aggregateType: text('aggregate_type').notNull(),
    routingKey: text('routing_key').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<EventJobPayload>().notNull(),
    occurredAt: timestamp('occurred_at', {
      mode: 'date',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'event_job_outbox_aggregate_type_valid',
      sql`${table.aggregateType} = 'eventa.event.jobs'`,
    ),
    check(
      'event_job_outbox_route_valid',
      sql`(${table.eventType} = 'event.media-verification.v1' AND ${table.routingKey} = 'eventa.event.media-verification.v1') OR (${table.eventType} = 'event.media-object-deletion.v1' AND ${table.routingKey} = 'eventa.event.media-object-deletion.v1')`,
    ),
  ],
);
