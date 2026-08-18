import {
  EventNotFoundError,
  EventTicketAvailabilityInvalidError,
} from '../errors/event.errors';
import type {
  AttendeeEventTicketCatalogueRecord,
  EventTicketAvailabilityManagement,
  EventTicketAvailabilityRepository,
} from '../types/event.types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class EventTicketAvailabilityService implements EventTicketAvailabilityManagement {
  constructor(
    private readonly availability: EventTicketAvailabilityRepository,
  ) {}

  async getCatalogue(
    eventId: string,
    attendeeId: string,
  ): Promise<AttendeeEventTicketCatalogueRecord> {
    if (!UUID_PATTERN.test(eventId) || !UUID_PATTERN.test(attendeeId)) {
      throw new EventTicketAvailabilityInvalidError();
    }
    const catalogue = await this.availability.getCatalogue(eventId, attendeeId);
    if (catalogue === undefined) throw new EventNotFoundError();
    return catalogue;
  }
}
