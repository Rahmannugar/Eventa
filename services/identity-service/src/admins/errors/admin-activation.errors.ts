export class AdminActivationRateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('ADMIN_ACTIVATION_RATE_LIMITED');
    this.name = AdminActivationRateLimitedError.name;
  }
}

export class AdminActivationStateUnavailableError extends Error {
  constructor() {
    super('ADMIN_ACTIVATION_STATE_UNAVAILABLE');
    this.name = AdminActivationStateUnavailableError.name;
  }
}

export class AdminActivationOtpInvalidError extends Error {
  constructor() {
    super('ADMIN_ACTIVATION_OTP_INVALID');
    this.name = AdminActivationOtpInvalidError.name;
  }
}

export class AdminActivationGrantInvalidError extends Error {
  constructor() {
    super('ADMIN_ACTIVATION_GRANT_INVALID');
    this.name = AdminActivationGrantInvalidError.name;
  }
}
