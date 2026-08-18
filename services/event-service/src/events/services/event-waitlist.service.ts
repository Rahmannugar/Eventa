import {
  EventCapacityBusyError,
  EventTicketSalesUnavailableError,
  EventTicketTypeNotFoundError,
  EventWaitlistConflictError,
  EventWaitlistEntryInvalidError,
  EventWaitlistEntryNotFoundError,
} from '../errors/event.errors';
import type {
  EventWaitlistCommand,
  EventWaitlistEntryRecord,
  EventWaitlistManagement,
  EventWaitlistRepository,
  JoinEventWaitlistCommand,
} from '../types/event.types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class EventWaitlistService implements EventWaitlistManagement {
  constructor(private readonly waitlist: EventWaitlistRepository) {}

  async join(
    input: JoinEventWaitlistCommand,
  ): Promise<EventWaitlistEntryRecord> {
    this.validate(input);
    if (
      !Number.isInteger(input.quantity) ||
      input.quantity < 1 ||
      input.quantity > 1_000_000
    ) {
      throw new EventWaitlistEntryInvalidError();
    }
    const result = await this.waitlist.join(input);
    if (result.outcome === 'not_found')
      throw new EventTicketTypeNotFoundError();
    if (result.outcome === 'sales_unavailable')
      throw new EventTicketSalesUnavailableError();
    if (result.outcome === 'capacity_available') {
      throw new EventWaitlistConflictError('EVENT_TICKET_CAPACITY_AVAILABLE');
    }
    if (result.outcome === 'quantity_exceeds_capacity') {
      throw new EventWaitlistConflictError(
        'EVENT_WAITLIST_QUANTITY_EXCEEDS_CAPACITY',
      );
    }
    if (result.outcome === 'quantity_conflict') {
      throw new EventWaitlistConflictError('EVENT_WAITLIST_QUANTITY_CONFLICT');
    }
    if (result.outcome === 'active_reservation') {
      throw new EventWaitlistConflictError(
        'EVENT_WAITLIST_ACTIVE_RESERVATION_CONFLICT',
      );
    }
    if (result.outcome === 'full') {
      throw new EventWaitlistConflictError('EVENT_WAITLIST_FULL');
    }
    if (result.outcome === 'busy') throw new EventCapacityBusyError();
    return result.entry;
  }

  async leave(input: EventWaitlistCommand): Promise<void> {
    this.validate(input);
    const result = await this.waitlist.leave(input);
    if (result.outcome === 'not_found')
      throw new EventTicketTypeNotFoundError();
    if (result.outcome === 'busy') throw new EventCapacityBusyError();
  }

  async get(
    input: Omit<EventWaitlistCommand, 'requestId'>,
  ): Promise<EventWaitlistEntryRecord> {
    this.validate(input);
    const entry = await this.waitlist.find(input);
    if (entry === undefined) throw new EventWaitlistEntryNotFoundError();
    return entry;
  }

  private validate(input: {
    eventId: string;
    ticketTypeId: string;
    attendeeId: string;
  }): void {
    if (
      !UUID_PATTERN.test(input.eventId) ||
      !UUID_PATTERN.test(input.ticketTypeId) ||
      !UUID_PATTERN.test(input.attendeeId)
    ) {
      throw new EventWaitlistEntryInvalidError();
    }
  }
}
