import { InvalidAttendeeSessionError } from '../errors/attendee-session.errors';
import type {
  AttendeeAccount,
  AttendeeAccountRepository,
} from '../types/attendee-account.types';

export class AttendeeAccountService {
  constructor(private readonly repository: AttendeeAccountRepository) {}

  async getCurrentAccount(attendeeId: string): Promise<AttendeeAccount> {
    const attendee = await this.repository.findActiveAccount(attendeeId);

    if (attendee === undefined) {
      throw new InvalidAttendeeSessionError();
    }

    return attendee;
  }
}
