export class AdminSessionStateUnavailableError extends Error {
  constructor() {
    super('ADMIN_SESSION_STATE_UNAVAILABLE');
    this.name = AdminSessionStateUnavailableError.name;
  }
}

export class AdminSessionAccountBlockedError extends Error {
  constructor() {
    super('ADMIN_SESSION_ACCOUNT_BLOCKED');
    this.name = AdminSessionAccountBlockedError.name;
  }
}

export class InvalidAdminSessionError extends Error {
  constructor() {
    super('ADMIN_SESSION_INVALID');
    this.name = InvalidAdminSessionError.name;
  }
}
