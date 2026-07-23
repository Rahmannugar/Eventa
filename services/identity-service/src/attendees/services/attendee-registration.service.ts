import { Inject, Injectable } from '@nestjs/common';

import { PASSWORD_HASHER } from '../../security/constants/security.constants';
import type { PasswordHasher } from '../../security/types/password-hasher.types';
import { ATTENDEE_ACCOUNT_REPOSITORY } from '../constants/attendee-registration.constants';
import type { AttendeeAccountRepository } from '../types/attendee-account-repository.types';
import type {
  AttendeeRegistrar,
  RegisteredAttendee,
  RegisterAttendeeInput,
} from '../types/attendee-registration.types';

@Injectable()
export class AttendeeRegistrationService implements AttendeeRegistrar {
  constructor(
    @Inject(ATTENDEE_ACCOUNT_REPOSITORY)
    private readonly attendeeAccounts: AttendeeAccountRepository,
    @Inject(PASSWORD_HASHER)
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async register(input: RegisterAttendeeInput): Promise<RegisteredAttendee> {
    const email = input.email.trim().toLowerCase();
    const username = input.username.toLowerCase();
    const passwordHash = await this.passwordHasher.hash(input.password);

    return this.attendeeAccounts.create({
      email,
      passwordHash,
      username,
    });
  }
}
