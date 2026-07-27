export class InvalidAttendeeCredentialsError extends Error {
  constructor() {
    super('INVALID_ATTENDEE_CREDENTIALS');
    this.name = InvalidAttendeeCredentialsError.name;
  }
}

export class AttendeeEmailVerificationRequiredError extends Error {
  constructor() {
    super('ATTENDEE_EMAIL_VERIFICATION_REQUIRED');
    this.name = AttendeeEmailVerificationRequiredError.name;
  }
}

export class AttendeeAccountDeletedError extends Error {
  constructor() {
    super('ATTENDEE_ACCOUNT_DELETED');
    this.name = AttendeeAccountDeletedError.name;
  }
}

export class AttendeeAccountSuspendedError extends Error {
  constructor() {
    super('ATTENDEE_ACCOUNT_SUSPENDED');
    this.name = AttendeeAccountSuspendedError.name;
  }
}
