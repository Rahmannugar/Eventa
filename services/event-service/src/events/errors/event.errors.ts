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

export class EventTicketTypeInvalidError extends Error {
  constructor() {
    super('EVENT_TICKET_TYPE_INVALID');
    this.name = EventTicketTypeInvalidError.name;
  }
}

export class EventTicketTypeNameConflictError extends Error {
  constructor() {
    super('EVENT_TICKET_TYPE_NAME_CONFLICT');
    this.name = EventTicketTypeNameConflictError.name;
  }
}

export class EventTicketCurrencyConflictError extends Error {
  constructor() {
    super('EVENT_TICKET_CURRENCY_CONFLICT');
    this.name = EventTicketCurrencyConflictError.name;
  }
}

export class EventTicketCurrencyNotFoundError extends Error {
  constructor() {
    super('EVENT_TICKET_CURRENCY_NOT_FOUND');
    this.name = EventTicketCurrencyNotFoundError.name;
  }
}

export class EventTicketTypeLimitReachedError extends Error {
  constructor() {
    super('EVENT_TICKET_TYPE_LIMIT_REACHED');
    this.name = EventTicketTypeLimitReachedError.name;
  }
}

export class EventTicketTypeMutationNotAllowedError extends Error {
  constructor() {
    super('EVENT_TICKET_TYPE_MUTATION_NOT_ALLOWED');
    this.name = EventTicketTypeMutationNotAllowedError.name;
  }
}

export class EventTicketTypeNotFoundError extends Error {
  constructor() {
    super('EVENT_TICKET_TYPE_NOT_FOUND');
    this.name = EventTicketTypeNotFoundError.name;
  }
}

export class EventTicketTypeCapacityBelowCommittedError extends Error {
  constructor() {
    super('EVENT_TICKET_TYPE_CAPACITY_BELOW_COMMITTED');
    this.name = EventTicketTypeCapacityBelowCommittedError.name;
  }
}

export class EventTicketTypeCapacityBelowWaitlistDemandError extends Error {
  constructor() {
    super('EVENT_TICKET_TYPE_CAPACITY_BELOW_WAITLIST_DEMAND');
    this.name = EventTicketTypeCapacityBelowWaitlistDemandError.name;
  }
}

export class EventTicketTypeCommercialTermsLockedError extends Error {
  constructor() {
    super('EVENT_TICKET_TYPE_COMMERCIAL_TERMS_LOCKED');
    this.name = EventTicketTypeCommercialTermsLockedError.name;
  }
}

export class EventTicketTypeRetirementNotAllowedError extends Error {
  constructor(message = 'EVENT_TICKET_TYPE_RETIREMENT_NOT_ALLOWED') {
    super(message);
    this.name = EventTicketTypeRetirementNotAllowedError.name;
  }
}

export class EventCapacityReservationInvalidError extends Error {
  constructor() {
    super('EVENT_CAPACITY_RESERVATION_INVALID');
    this.name = EventCapacityReservationInvalidError.name;
  }
}

export class EventCapacityReservationNotFoundError extends Error {
  constructor() {
    super('EVENT_CAPACITY_RESERVATION_NOT_FOUND');
    this.name = EventCapacityReservationNotFoundError.name;
  }
}

export class EventCapacityReservationConflictError extends Error {
  constructor(message = 'EVENT_CAPACITY_RESERVATION_CONFLICT') {
    super(message);
    this.name = EventCapacityReservationConflictError.name;
  }
}

export class EventCapacityUnavailableError extends Error {
  constructor() {
    super('EVENT_TICKET_CAPACITY_UNAVAILABLE');
    this.name = EventCapacityUnavailableError.name;
  }
}

export class EventCapacityBusyError extends Error {
  constructor() {
    super('EVENT_CAPACITY_BUSY');
    this.name = EventCapacityBusyError.name;
  }
}

export class EventTicketSalesUnavailableError extends Error {
  constructor() {
    super('EVENT_TICKET_SALES_UNAVAILABLE');
    this.name = EventTicketSalesUnavailableError.name;
  }
}

export class EventWaitlistEntryInvalidError extends Error {
  constructor() {
    super('EVENT_WAITLIST_ENTRY_INVALID');
    this.name = EventWaitlistEntryInvalidError.name;
  }
}

export class EventWaitlistEntryNotFoundError extends Error {
  constructor() {
    super('EVENT_WAITLIST_ENTRY_NOT_FOUND');
    this.name = EventWaitlistEntryNotFoundError.name;
  }
}

export class EventWaitlistConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = EventWaitlistConflictError.name;
  }
}
