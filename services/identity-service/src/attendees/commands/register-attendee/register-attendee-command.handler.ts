import { Inject, Injectable } from '@nestjs/common';

import { PASSWORD_HASHER } from '../../../security/constants/security.constants';
import type { PasswordHasher } from '../../../security/types/password-hasher.types';
import { ATTENDEE_ACCOUNT_WRITER } from '../../constants/attendee-registration.constants';
import type { AttendeeAccountWriter } from '../../types/attendee-account-write.types';
import type {
  RegisteredAttendee,
  RegisterAttendeeCommand,
  RegisterAttendeeHandler,
} from './register-attendee.command';

@Injectable()
export class RegisterAttendeeCommandHandler implements RegisterAttendeeHandler {
  constructor(
    @Inject(ATTENDEE_ACCOUNT_WRITER)
    private readonly attendeeAccountWriter: AttendeeAccountWriter,
    @Inject(PASSWORD_HASHER)
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async handle(command: RegisterAttendeeCommand): Promise<RegisteredAttendee> {
    const email = command.email.trim().toLowerCase();
    const username = command.username.toLowerCase();
    const passwordHash = await this.passwordHasher.hash(command.password);

    return this.attendeeAccountWriter.create({
      email,
      passwordHash,
      username,
    });
  }
}
