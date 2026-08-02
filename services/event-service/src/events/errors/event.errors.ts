export class EventNotFoundError extends Error {
  constructor() {
    super('EVENT_NOT_FOUND');
    this.name = EventNotFoundError.name;
  }
}

export class EventVersionConflictError extends Error {
  constructor() {
    super('EVENT_VERSION_CONFLICT');
    this.name = EventVersionConflictError.name;
  }
}

export class EventScheduleInvalidError extends Error {
  constructor() {
    super('EVENT_SCHEDULE_INVALID');
    this.name = EventScheduleInvalidError.name;
  }
}
