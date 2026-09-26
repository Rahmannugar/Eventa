export class AttendeeContactNotFoundError extends Error {
  constructor() {
    super('ATTENDEE_CONTACT_NOT_FOUND');
    this.name = AttendeeContactNotFoundError.name;
  }
}

export class EventSummaryNotFoundError extends Error {
  constructor() {
    super('EVENT_SUMMARY_NOT_FOUND');
    this.name = EventSummaryNotFoundError.name;
  }
}
