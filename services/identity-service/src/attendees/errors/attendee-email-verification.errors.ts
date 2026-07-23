export class EmailVerificationOtpInvalidError extends Error {
  constructor() {
    super('EMAIL_VERIFICATION_OTP_INVALID_OR_EXPIRED');
    this.name = 'EmailVerificationOtpInvalidError';
  }
}

export class EmailVerificationResendRateLimitedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('EMAIL_VERIFICATION_RATE_LIMITED');
    this.name = 'EmailVerificationResendRateLimitedError';
  }
}

export class EmailVerificationStateUnavailableError extends Error {
  constructor() {
    super('EMAIL_VERIFICATION_STATE_UNAVAILABLE');
    this.name = 'EmailVerificationStateUnavailableError';
  }
}
