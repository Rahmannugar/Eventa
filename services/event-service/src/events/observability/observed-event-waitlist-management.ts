import { recordBusinessOutcome } from '@eventa/observability';

import {
  EventCapacityBusyError,
  EventTicketSalesUnavailableError,
  EventTicketTypeNotFoundError,
  EventWaitlistConflictError,
  EventWaitlistEntryInvalidError,
} from '../errors/event.errors';
import type {
  EventWaitlistCommand,
  EventWaitlistEntryRecord,
  EventWaitlistManagement,
  JoinEventWaitlistCommand,
} from '../types/event.types';

export class ObservedEventWaitlistManagement implements EventWaitlistManagement {
  constructor(private readonly waitlist: EventWaitlistManagement) {}

  async join(
    input: JoinEventWaitlistCommand,
  ): Promise<EventWaitlistEntryRecord> {
    try {
      const entry = await this.waitlist.join(input);
      this.record('event.waitlist_join', 'joined');
      return entry;
    } catch (error: unknown) {
      this.record('event.waitlist_join', this.joinFailure(error));
      throw error;
    }
  }

  async leave(input: EventWaitlistCommand): Promise<void> {
    try {
      await this.waitlist.leave(input);
      this.record('event.waitlist_leave', 'left');
    } catch (error: unknown) {
      this.record(
        'event.waitlist_leave',
        error instanceof EventCapacityBusyError
          ? 'busy'
          : error instanceof EventTicketTypeNotFoundError
            ? 'not_found'
            : 'failed',
      );
      throw error;
    }
  }

  get(
    input: Omit<EventWaitlistCommand, 'requestId'>,
  ): Promise<EventWaitlistEntryRecord> {
    return this.waitlist.get(input);
  }

  private joinFailure(error: unknown): string {
    if (error instanceof EventCapacityBusyError) return 'busy';
    if (error instanceof EventTicketTypeNotFoundError) return 'not_found';
    if (error instanceof EventTicketSalesUnavailableError)
      return 'sales_unavailable';
    if (error instanceof EventWaitlistEntryInvalidError) return 'invalid';
    if (!(error instanceof EventWaitlistConflictError)) return 'failed';
    return (
      {
        EVENT_TICKET_CAPACITY_AVAILABLE: 'capacity_available',
        EVENT_WAITLIST_ACTIVE_RESERVATION_CONFLICT: 'active_reservation',
        EVENT_WAITLIST_FULL: 'full',
        EVENT_WAITLIST_QUANTITY_CONFLICT: 'quantity_conflict',
        EVENT_WAITLIST_QUANTITY_EXCEEDS_CAPACITY: 'quantity_invalid',
      }[error.message] ?? 'conflict'
    );
  }

  private record(operation: string, outcome: string): void {
    recordBusinessOutcome({ operation, outcome });
  }
}
