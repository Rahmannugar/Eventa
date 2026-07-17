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

export interface RegisterAttendeeInput {
  email: string;
  password: string;
  username: string;
}

export interface AttendeeRegistrar {
  register(input: RegisterAttendeeInput): Promise<RegisteredAttendee>;
}

export interface AttendeeRegistrationStore {
  create(input: CreateAttendeeAccount): Promise<RegisteredAttendee>;
}
