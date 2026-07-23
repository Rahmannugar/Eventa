export interface RegisterAttendeeInput {
  email: string;
  password: string;
  username: string;
}

export interface RegisteredAttendee {
  attendeeId: string;
  email: string;
  username: string;
  emailVerified: false;
}

export interface AttendeeRegistrar {
  register(input: RegisterAttendeeInput): Promise<RegisteredAttendee>;
}
