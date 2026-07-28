export class PasswordResetStateUnavailableError extends Error {
  constructor() {
    super('PASSWORD_RESET_STATE_UNAVAILABLE');
    this.name = PasswordResetStateUnavailableError.name;
  }
}
