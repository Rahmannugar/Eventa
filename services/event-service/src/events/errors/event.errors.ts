export class EventNotFoundError extends Error {
  constructor() {
    super('EVENT_NOT_FOUND');
    this.name = EventNotFoundError.name;
  }
}
