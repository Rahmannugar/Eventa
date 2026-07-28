export class PasswordResetCodeInvalidError extends Error {
  constructor() {
    super('PASSWORD_RESET_CODE_INVALID_OR_EXPIRED');
    this.name = 'PasswordResetCodeInvalidError';
  }
}

export class PasswordResetRateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('PASSWORD_RESET_RATE_LIMITED');
    this.name = 'PasswordResetRateLimitedError';
  }
}

export class PasswordResetStateUnavailableError extends Error {
  constructor() {
    super('PASSWORD_RESET_STATE_UNAVAILABLE');
    this.name = 'PasswordResetStateUnavailableError';
  }
}
