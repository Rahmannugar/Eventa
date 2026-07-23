import type { RegisteredAttendee } from './attendee-registration.types';

export interface CreateAttendeeAccount {
  email: string;
  passwordHash: string;
  username: string;
}

export interface AttendeeAccountRepository {
  create(input: CreateAttendeeAccount): Promise<RegisteredAttendee>;
}
