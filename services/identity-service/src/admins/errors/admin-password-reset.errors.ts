export class AdminPasswordResetCodeInvalidError extends Error {
  constructor() {
    super('ADMIN_PASSWORD_RESET_CODE_INVALID_OR_EXPIRED');
    this.name = AdminPasswordResetCodeInvalidError.name;
  }
}

export class AdminPasswordResetRateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('ADMIN_PASSWORD_RESET_RATE_LIMITED');
    this.name = AdminPasswordResetRateLimitedError.name;
  }
}
