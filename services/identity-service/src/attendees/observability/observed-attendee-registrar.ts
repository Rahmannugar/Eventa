import { recordBusinessOutcome } from '@eventa/observability';

import type {
  RegisteredAttendee,
  RegisterAttendeeInput,
  AttendeeRegistrar,
} from '../types/attendee-registration.types';
import {
  EmailAlreadyRegisteredError,
  UsernameUnavailableError,
} from '../errors/attendee-registration.errors';

export class ObservedAttendeeRegistrar implements AttendeeRegistrar {
  constructor(private readonly registrar: AttendeeRegistrar) {}

  async register(input: RegisterAttendeeInput): Promise<RegisteredAttendee> {
    try {
      const attendee = await this.registrar.register(input);
      this.record('created');
      return attendee;
    } catch (error: unknown) {
      if (error instanceof EmailAlreadyRegisteredError) {
        this.record('email_conflict');
      } else if (error instanceof UsernameUnavailableError) {
        this.record('username_conflict');
      } else {
        this.record('failed');
      }

      throw error;
    }
  }

  private record(outcome: string): void {
    recordBusinessOutcome({
      operation: 'attendee.registration',
      outcome,
    });
  }
}
