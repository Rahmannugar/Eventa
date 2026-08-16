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

export class EventCategoriesInvalidError extends Error {
  constructor() {
    super('EVENT_CATEGORIES_INVALID');
    this.name = EventCategoriesInvalidError.name;
  }
}

export class EventVenueInvalidError extends Error {
  constructor() {
    super('EVENT_VENUE_INVALID');
    this.name = EventVenueInvalidError.name;
  }
}

export class EventPageTokenInvalidError extends Error {
  constructor() {
    super('EVENT_PAGE_TOKEN_INVALID');
    this.name = EventPageTokenInvalidError.name;
  }
}

export class EventPublicationIncompleteError extends Error {
  constructor() {
    super('EVENT_PUBLICATION_INCOMPLETE');
    this.name = EventPublicationIncompleteError.name;
  }
}

export class EventRetirementNotAllowedError extends Error {
  constructor() {
    super('EVENT_RETIREMENT_NOT_ALLOWED');
    this.name = EventRetirementNotAllowedError.name;
  }
}

export class EventMediaNotFoundError extends Error {
  constructor() {
    super('EVENT_MEDIA_NOT_FOUND');
    this.name = 'EventMediaNotFoundError';
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
