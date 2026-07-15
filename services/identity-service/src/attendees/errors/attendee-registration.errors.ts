export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super('EMAIL_ALREADY_REGISTERED');
    this.name = EmailAlreadyRegisteredError.name;
  }
}

export class UsernameUnavailableError extends Error {
  constructor() {
    super('USERNAME_UNAVAILABLE');
    this.name = UsernameUnavailableError.name;
  }
}
