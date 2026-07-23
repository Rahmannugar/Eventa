import { Inject } from '@nestjs/common';
import { runWithOperationSpan } from '@eventa/observability';
import { eq, sql } from 'drizzle-orm';

import { IDENTITY_DATABASE } from '../../database/database.constants';
import type { IdentityDatabase } from '../../database/database.types';
import { attendeeAccounts } from '../schema/attendee.schema';
import {
  EmailAlreadyRegisteredError,
  UsernameUnavailableError,
} from '../errors/attendee-registration.errors';
import type {
  AttendeeAccountRepository,
  CreateAttendeeAccount,
} from '../types/attendee-account-repository.types';
import type {
  AttendeeEmailVerificationAccount,
  AttendeeEmailVerificationRepository,
} from '../types/attendee-email-verification.types';
import type { RegisteredAttendee } from '../types/attendee-registration.types';

const UNIQUE_VIOLATION = '23505';

function readDatabaseErrorField(
  error: unknown,
  field: string,
): string | undefined {
  let current: unknown = error;

  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }

    if (field in current) {
      const value: unknown = Reflect.get(current, field);

      if (typeof value === 'string') {
        return value;
      }
    }

    current = Reflect.get(current, 'cause');
  }

  return undefined;
}

export class PostgresAttendeeAccountRepository
  implements AttendeeAccountRepository, AttendeeEmailVerificationRepository
{
  constructor(
    @Inject(IDENTITY_DATABASE)
    private readonly database: IdentityDatabase,
  ) {}

  async create(input: CreateAttendeeAccount): Promise<RegisteredAttendee> {
    return runWithOperationSpan(
      'INSERT attendee_accounts',
      async () => {
        try {
          const [account] = await this.database
            .insert(attendeeAccounts)
            .values({
              email: input.email,
              passwordHash: input.passwordHash,
              username: input.username,
            })
            .returning({
              attendeeId: attendeeAccounts.id,
              email: attendeeAccounts.email,
              username: attendeeAccounts.username,
            });

          if (account === undefined) {
            throw new Error('Attendee account insert returned no row');
          }

          return { ...account, emailVerified: false };
        } catch (error: unknown) {
          if (readDatabaseErrorField(error, 'code') !== UNIQUE_VIOLATION) {
            throw error;
          }

          const constraint = readDatabaseErrorField(error, 'constraint_name');

          if (constraint === 'attendee_accounts_email_unique') {
            throw new EmailAlreadyRegisteredError();
          }

          if (constraint === 'attendee_accounts_username_unique') {
            throw new UsernameUnavailableError();
          }

          throw error;
        }
      },
      {
        attributes: {
          'db.namespace': 'eventa_identity',
          'db.operation.name': 'INSERT',
          'db.system.name': 'postgresql',
          'db.collection.name': 'attendee_accounts',
        },
        kind: 'client',
      },
    );
  }

  async findByEmail(
    email: string,
  ): Promise<AttendeeEmailVerificationAccount | undefined> {
    const [account] = await this.database
      .select({
        attendeeId: attendeeAccounts.id,
        emailVerifiedAt: attendeeAccounts.emailVerifiedAt,
      })
      .from(attendeeAccounts)
      .where(eq(attendeeAccounts.email, email))
      .limit(1);

    if (account === undefined) {
      return undefined;
    }

    return {
      attendeeId: account.attendeeId,
      emailVerified: account.emailVerifiedAt !== null,
    };
  }

  async markEmailVerified(attendeeId: string): Promise<boolean> {
    const [account] = await this.database
      .update(attendeeAccounts)
      .set({
        emailVerifiedAt: sql`COALESCE(${attendeeAccounts.emailVerifiedAt}, NOW())`,
      })
      .where(eq(attendeeAccounts.id, attendeeId))
      .returning({ attendeeId: attendeeAccounts.id });

    return account !== undefined;
  }
}
