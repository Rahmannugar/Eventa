import { Inject } from '@nestjs/common';

import { IDENTITY_DATABASE } from '../../database/database.constants';
import type { IdentityDatabase } from '../../database/database.types';
import { attendeeAccounts, attendeeProfiles } from '../schema/attendee.schema';
import {
  EmailAlreadyRegisteredError,
  UsernameUnavailableError,
} from '../errors/attendee-registration.errors';
import type {
  AttendeeRegistrationStore,
  CreateAttendeeAccount,
  RegisteredAttendee,
} from '../types/attendee-registration.types';

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

export class AttendeeRegistrationRepository implements AttendeeRegistrationStore {
  constructor(
    @Inject(IDENTITY_DATABASE)
    private readonly database: IdentityDatabase,
  ) {}

  async create(input: CreateAttendeeAccount): Promise<RegisteredAttendee> {
    try {
      return await this.database.transaction(async (transaction) => {
        const [account] = await transaction
          .insert(attendeeAccounts)
          .values({
            email: input.email,
            passwordHash: input.passwordHash,
          })
          .returning({
            attendeeId: attendeeAccounts.id,
            email: attendeeAccounts.email,
          });

        if (account === undefined) {
          throw new Error('Attendee account insert returned no row');
        }

        const [profile] = await transaction
          .insert(attendeeProfiles)
          .values({
            attendeeId: account.attendeeId,
            username: input.username,
          })
          .returning({ username: attendeeProfiles.username });

        if (profile === undefined) {
          throw new Error('Attendee profile insert returned no row');
        }

        return {
          attendeeId: account.attendeeId,
          email: account.email,
          username: profile.username,
          emailVerified: false,
        };
      });
    } catch (error: unknown) {
      if (readDatabaseErrorField(error, 'code') !== UNIQUE_VIOLATION) {
        throw error;
      }

      const constraint = readDatabaseErrorField(error, 'constraint_name');

      if (constraint === 'attendee_accounts_email_unique') {
        throw new EmailAlreadyRegisteredError();
      }

      if (constraint === 'attendee_profiles_username_unique') {
        throw new UsernameUnavailableError();
      }

      throw error;
    }
  }
}
