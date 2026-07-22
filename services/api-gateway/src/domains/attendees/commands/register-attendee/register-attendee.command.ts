export class RegisterAttendeeCommand {
  constructor(
    readonly email: string,
    readonly password: string,
    readonly username: string,
    readonly requestId: string,
  ) {}
}
