import { AttendeeContactNotFoundError } from '../errors/attendee-contact.errors';
import { InvalidAttendeeSessionError } from '../errors/attendee-session.errors';
import type {
  AttendeeAccount,
  AttendeeAccountRepository,
  AttendeeContact,
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

  async getContact(attendeeId: string): Promise<AttendeeContact> {
    const contact = await this.repository.findContactEmail(attendeeId);

    if (contact === undefined) {
      throw new AttendeeContactNotFoundError();
    }

    return contact;
  }
}
