export class AttendeeSessionStateUnavailableError extends Error {
  constructor() {
    super('ATTENDEE_SESSION_STATE_UNAVAILABLE');
    this.name = 'AttendeeSessionStateUnavailableError';
  }
}

export class AttendeeSessionAccountBlockedError extends Error {
  constructor(
    readonly reason: 'account-deletion' | 'password-reset' = 'account-deletion',
  ) {
    super('ATTENDEE_SESSION_ACCOUNT_BLOCKED');
    this.name = AttendeeSessionAccountBlockedError.name;
  }
}

export class InvalidAttendeeSessionError extends Error {
  constructor() {
    super('ATTENDEE_SESSION_INVALID');
    this.name = InvalidAttendeeSessionError.name;
  }
}
