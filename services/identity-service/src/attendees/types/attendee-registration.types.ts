export interface CreateAttendeeAccount {
  email: string;
  passwordHash: string;
  username: string;
}

export interface RegisteredAttendee {
  attendeeId: string;
  email: string;
  username: string;
  emailVerified: false;
}

export interface AttendeeRegistrationStore {
  create(input: CreateAttendeeAccount): Promise<RegisteredAttendee>;
}
