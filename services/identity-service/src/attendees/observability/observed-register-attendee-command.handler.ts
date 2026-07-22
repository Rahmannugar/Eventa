import { recordBusinessOutcome } from '@eventa/observability';

import type {
  RegisteredAttendee,
  RegisterAttendeeCommand,
  RegisterAttendeeHandler,
} from '../commands/register-attendee/register-attendee.command';
import {
  EmailAlreadyRegisteredError,
  UsernameUnavailableError,
} from '../errors/attendee-registration.errors';

export class ObservedRegisterAttendeeCommandHandler implements RegisterAttendeeHandler {
  constructor(private readonly handler: RegisterAttendeeHandler) {}

  async handle(command: RegisterAttendeeCommand): Promise<RegisteredAttendee> {
    try {
      const attendee = await this.handler.handle(command);
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
