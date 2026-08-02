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

export class EventMediaSlotOccupiedError extends Error {
  constructor() {
    super('EVENT_MEDIA_SLOT_OCCUPIED');
    this.name = 'EventMediaSlotOccupiedError';
  }
}

export class EventMediaUploadInProgressError extends Error {
  constructor() {
    super('EVENT_MEDIA_UPLOAD_IN_PROGRESS');
    this.name = 'EventMediaUploadInProgressError';
  }
}

export class EventMediaUploadNotFoundError extends Error {
  constructor() {
    super('EVENT_MEDIA_UPLOAD_NOT_FOUND');
    this.name = 'EventMediaUploadNotFoundError';
  }
}
