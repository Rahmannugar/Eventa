import { sql } from 'drizzle-orm';
import {
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const adminAccounts = pgTable(
  'admin_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    passwordResetId: uuid('password_reset_id'),
    emailVerifiedAt: timestamp('email_verified_at', {
      mode: 'date',
      withTimezone: true,
    }),
    activatedAt: timestamp('activated_at', {
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
    uniqueIndex('admin_accounts_email_unique').on(table.email),
    check(
      'admin_accounts_email_canonical',
      sql`${table.email} = lower(btrim(${table.email}))`,
    ),
    check(
      'admin_accounts_activation_consistent',
      sql`(${table.activatedAt} IS NULL AND ${table.passwordHash} IS NULL) OR (${table.activatedAt} IS NOT NULL AND ${table.passwordHash} IS NOT NULL AND ${table.emailVerifiedAt} IS NOT NULL)`,
    ),
  ],
);
