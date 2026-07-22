export class RegisterAttendeeCommand {
  constructor(
    readonly email: string,
    readonly password: string,
    readonly username: string,
  ) {}
}

export interface RegisteredAttendee {
  attendeeId: string;
  email: string;
  username: string;
  emailVerified: false;
}

export interface RegisterAttendeeHandler {
  handle(command: RegisterAttendeeCommand): Promise<RegisteredAttendee>;
}
