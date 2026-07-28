export class InvalidAdminCredentialsError extends Error {
  constructor() {
    super('INVALID_ADMIN_CREDENTIALS');
    this.name = InvalidAdminCredentialsError.name;
  }
}

export class AdminSessionStateUnavailableError extends Error {
  constructor() {
    super('ADMIN_SESSION_STATE_UNAVAILABLE');
    this.name = AdminSessionStateUnavailableError.name;
  }
}
