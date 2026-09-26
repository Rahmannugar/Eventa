export class AttendeeContactNotFoundError extends Error {
  constructor() {
    super('ATTENDEE_CONTACT_NOT_FOUND');
    this.name = AttendeeContactNotFoundError.name;
  }
}
