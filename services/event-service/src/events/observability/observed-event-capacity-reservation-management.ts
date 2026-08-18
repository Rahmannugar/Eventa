import { recordBusinessOutcome } from '@eventa/observability';

import {
  EventCapacityBusyError,
  EventCapacityReservationConflictError,
  EventCapacityUnavailableError,
  EventTicketSalesUnavailableError,
  EventTicketTypeNotFoundError,
} from '../errors/event.errors';
import type {
  EventCapacityReservationManagement,
  EventCapacityReservationRecord,
  ReserveEventCapacityCommand,
  TransitionEventCapacityReservationCommand,
} from '../types/event.types';

export class ObservedEventCapacityReservationManagement implements EventCapacityReservationManagement {
  constructor(
    private readonly reservations: EventCapacityReservationManagement,
  ) {}

  async reserve(
    input: ReserveEventCapacityCommand,
  ): Promise<EventCapacityReservationRecord> {
    try {
      const reservation = await this.reservations.reserve(input);
      this.record('event.capacity_reserve', 'reserved');
      return reservation;
    } catch (error: unknown) {
      this.record('event.capacity_reserve', this.failure(error));
      throw error;
    }
  }

  finalize(
    input: TransitionEventCapacityReservationCommand,
  ): Promise<EventCapacityReservationRecord> {
    return this.transition('event.capacity_finalize', 'finalized', () =>
      this.reservations.finalize(input),
    );
  }

  release(
    input: TransitionEventCapacityReservationCommand,
  ): Promise<EventCapacityReservationRecord> {
    return this.transition('event.capacity_release', 'released', () =>
      this.reservations.release(input),
    );
  }

  private async transition(
    operation: string,
    completedOutcome: string,
    execute: () => Promise<EventCapacityReservationRecord>,
  ): Promise<EventCapacityReservationRecord> {
    try {
      const reservation = await execute();
      this.record(operation, completedOutcome);
      return reservation;
    } catch (error: unknown) {
      this.record(operation, this.failure(error));
      throw error;
    }
  }

  private failure(error: unknown): string {
    if (error instanceof EventCapacityBusyError) return 'busy';
    if (error instanceof EventCapacityUnavailableError) return 'unavailable';
    if (error instanceof EventTicketSalesUnavailableError)
      return 'sales_unavailable';
    if (error instanceof EventTicketTypeNotFoundError) return 'not_found';
    if (error instanceof EventCapacityReservationConflictError)
      return 'conflict';
    return 'failed';
  }

  private record(operation: string, outcome: string): void {
    recordBusinessOutcome({ operation, outcome });
  }
}
