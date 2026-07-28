export class AttendeeSessionStateUnavailableError extends Error {
  constructor() {
    super('ATTENDEE_SESSION_STATE_UNAVAILABLE');
    this.name = 'AttendeeSessionStateUnavailableError';
  }
}

export class InvalidAttendeeSessionError extends Error {
  constructor() {
    super('ATTENDEE_SESSION_INVALID');
    this.name = InvalidAttendeeSessionError.name;
  }
}
