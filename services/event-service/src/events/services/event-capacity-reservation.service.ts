import {
  EventCapacityReservationConflictError,
  EventCapacityBusyError,
  EventCapacityReservationInvalidError,
  EventCapacityReservationNotFoundError,
  EventCapacityUnavailableError,
  EventTicketSalesUnavailableError,
  EventTicketTypeNotFoundError,
} from '../errors/event.errors';
import type {
  EventCapacityReservationManagement,
  EventCapacityReservationRepository,
  EventCapacityReservationRecord,
  ReserveEventCapacityCommand,
  TransitionEventCapacityReservationCommand,
} from '../types/event.types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class EventCapacityReservationService implements EventCapacityReservationManagement {
  constructor(
    private readonly reservations: EventCapacityReservationRepository,
  ) {}

  async reserve(
    input: ReserveEventCapacityCommand,
  ): Promise<EventCapacityReservationRecord> {
    this.validateIdentity(input);
    if (
      !Number.isInteger(input.quantity) ||
      input.quantity < 1 ||
      input.quantity > 1_000_000
    ) {
      throw new EventCapacityReservationInvalidError();
    }
    const result = await this.reservations.reserve(input);
    if (result.outcome === 'not_found') {
      throw new EventTicketTypeNotFoundError();
    }
    if (result.outcome === 'sales_unavailable') {
      throw new EventTicketSalesUnavailableError();
    }
    if (result.outcome === 'capacity_unavailable') {
      throw new EventCapacityUnavailableError();
    }
    if (result.outcome === 'busy') throw new EventCapacityBusyError();
    if (result.outcome === 'idempotency_conflict') {
      throw new EventCapacityReservationConflictError(
        'EVENT_CAPACITY_RESERVATION_IDEMPOTENCY_CONFLICT',
      );
    }
    return result.reservation;
  }

  async finalize(
    input: TransitionEventCapacityReservationCommand,
  ): Promise<EventCapacityReservationRecord> {
    this.validateIdentity(input);
    const result = await this.reservations.finalize(input);
    if (result.outcome === 'busy') throw new EventCapacityBusyError();
    if (result.outcome === 'not_found') {
      throw new EventCapacityReservationNotFoundError();
    }
    if (result.outcome === 'identity_conflict') {
      throw new EventCapacityReservationConflictError(
        'EVENT_CAPACITY_RESERVATION_IDENTITY_CONFLICT',
      );
    }
    if (result.outcome === 'expired') {
      throw new EventCapacityReservationConflictError(
        'EVENT_CAPACITY_RESERVATION_EXPIRED',
      );
    }
    if (result.outcome === 'terminal_conflict') {
      throw new EventCapacityReservationConflictError(
        'EVENT_CAPACITY_RESERVATION_ALREADY_RELEASED',
      );
    }
    return result.reservation;
  }

  async release(
    input: TransitionEventCapacityReservationCommand,
  ): Promise<EventCapacityReservationRecord> {
    this.validateIdentity(input);
    const result = await this.reservations.release(input);
    if (result.outcome === 'busy') throw new EventCapacityBusyError();
    if (result.outcome === 'not_found') {
      throw new EventCapacityReservationNotFoundError();
    }
    if (result.outcome === 'identity_conflict') {
      throw new EventCapacityReservationConflictError(
        'EVENT_CAPACITY_RESERVATION_IDENTITY_CONFLICT',
      );
    }
    if (result.outcome === 'terminal_conflict') {
      throw new EventCapacityReservationConflictError(
        'EVENT_CAPACITY_RESERVATION_ALREADY_FINALIZED',
      );
    }
    return result.reservation;
  }

  private validateIdentity(input: {
    reservationId: string;
    eventId: string;
    ticketTypeId: string;
  }): void {
    if (
      !UUID_PATTERN.test(input.reservationId) ||
      !UUID_PATTERN.test(input.eventId) ||
      !UUID_PATTERN.test(input.ticketTypeId)
    ) {
      throw new EventCapacityReservationInvalidError();
    }
  }
}
