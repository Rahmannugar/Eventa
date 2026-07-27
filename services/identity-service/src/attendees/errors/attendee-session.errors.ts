export class AttendeeSessionStateUnavailableError extends Error {
  constructor() {
    super('ATTENDEE_SESSION_STATE_UNAVAILABLE');
    this.name = 'AttendeeSessionStateUnavailableError';
  }
}
