import type { RegisteredAttendee } from '../commands/register-attendee/register-attendee.command';

export interface CreateAttendeeAccount {
  email: string;
  passwordHash: string;
  username: string;
}

export interface AttendeeAccountWriter {
  create(input: CreateAttendeeAccount): Promise<RegisteredAttendee>;
}
