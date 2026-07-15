import { Inject, Injectable } from '@nestjs/common';

import { PASSWORD_HASHER } from '../../security/constants/security.constants';
import type { PasswordHasher } from '../../security/types/password-hasher.types';
import { ATTENDEE_REGISTRATION_STORE } from '../constants/attendee-registration.constants';
import type {
  AttendeeRegistrationStore,
  RegisteredAttendee,
} from '../types/attendee-registration.types';
import type { RegisterAttendeeDto } from '../dto/register-attendee.dto';

@Injectable()
export class RegisterAttendeeService {
  constructor(
    @Inject(ATTENDEE_REGISTRATION_STORE)
    private readonly repository: AttendeeRegistrationStore,
    @Inject(PASSWORD_HASHER)
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async execute(input: RegisterAttendeeDto): Promise<RegisteredAttendee> {
    const email = input.email.trim().toLowerCase();
    const username = input.username.toLowerCase();
    const passwordHash = await this.passwordHasher.hash(input.password);

    return this.repository.create({ email, passwordHash, username });
  }
}
