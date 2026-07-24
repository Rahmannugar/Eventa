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

export const emailVerificationDeliveries = pgTable(
  'email_verification_deliveries',
  {
    jobId: uuid('job_id').primaryKey(),
    jobType: text('job_type').notNull(),
    status: text('status').notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    providerMessageId: text('provider_message_id'),
    failureCode: text('failure_code'),
    expiresAt: timestamp('expires_at', {
      mode: 'date',
      withTimezone: true,
    }).notNull(),
    processingToken: uuid('processing_token'),
    leaseExpiresAt: timestamp('lease_expires_at', {
      mode: 'date',
      withTimezone: true,
    }),
    nextAttemptAt: timestamp('next_attempt_at', {
      mode: 'date',
      withTimezone: true,
    }),
    deliveredAt: timestamp('delivered_at', {
      mode: 'date',
      withTimezone: true,
    }),
    terminalAt: timestamp('terminal_at', {
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
    check(
      'email_verification_deliveries_status_valid',
      sql`${table.status} IN ('pending', 'processing', 'retry_scheduled', 'delivered', 'failed', 'expired', 'rejected')`,
    ),
    check(
      'email_verification_deliveries_attempt_count_valid',
      sql`${table.attemptCount} >= 0 AND ${table.attemptCount} <= 3`,
    ),
    index('email_verification_deliveries_status_idx').on(table.status),
    index('email_verification_deliveries_next_attempt_idx').on(
      table.nextAttemptAt,
    ),
  ],
);
