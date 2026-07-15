import { sql } from 'drizzle-orm';
import {
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const attendeeAccounts = pgTable(
  'attendee_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', {
      mode: 'date',
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('attendee_accounts_email_unique').on(table.email),
    check(
      'attendee_accounts_email_canonical',
      sql`${table.email} = lower(${table.email})`,
    ),
  ],
);

export const attendeeProfiles = pgTable(
  'attendee_profiles',
  {
    attendeeId: uuid('attendee_id')
      .primaryKey()
      .references(() => attendeeAccounts.id, { onDelete: 'cascade' }),
    username: text('username').notNull(),
    createdAt: timestamp('created_at', {
      mode: 'date',
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('attendee_profiles_username_unique').on(table.username),
    check(
      'attendee_profiles_username_canonical',
      sql`${table.username} ~ '^[a-z0-9_]{3,30}$'`,
    ),
  ],
);
