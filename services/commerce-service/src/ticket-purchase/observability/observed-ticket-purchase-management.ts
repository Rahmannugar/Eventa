import { recordBusinessOutcome } from '@eventa/observability';
import { status } from '@grpc/grpc-js';

import type { CommerceOrderRecord } from '../../orders/types/order.types';
import type {
  StartTicketPurchaseCommand,
  TicketPurchaseManagement,
} from '../types/ticket-purchase.types';

export class ObservedTicketPurchaseManagement implements TicketPurchaseManagement {
  constructor(private readonly purchases: TicketPurchaseManagement) {}

  async start(input: StartTicketPurchaseCommand): Promise<CommerceOrderRecord> {
    try {
      const order = await this.purchases.start(input);
      this.record('ready_for_payment');
      return order;
    } catch (error: unknown) {
      this.record(this.failure(error));
      throw error;
    }
  }

  private failure(error: unknown): string {
    if (error instanceof Error) {
      if (error.message === 'Order idempotency conflict') {
        return 'idempotency_conflict';
      }
      if (
        error.message === 'EVENT_CAPACITY_RESERVATION_INVALID_RESPONSE' ||
        error.message === 'EVENT_CAPACITY_RESERVATION_INVALID_EXPIRY'
      ) {
        return 'invalid_reservation';
      }
      if (error.message === 'ORDER_TOTAL_OUT_OF_RANGE') {
        return 'total_out_of_range';
      }
    }

    const code = this.grpcCode(error);
    if (code === status.RESOURCE_EXHAUSTED) return 'capacity_unavailable';
    if (code === status.FAILED_PRECONDITION) return 'checkout_unavailable';
    if (code === status.ALREADY_EXISTS) return 'reservation_conflict';
    if (code === status.DEADLINE_EXCEEDED) return 'dependency_timeout';
    if (code === status.UNAVAILABLE) return 'dependency_unavailable';
    return 'failed';
  }

  private grpcCode(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = (error as { code?: unknown }).code;
    return typeof code === 'number' ? code : undefined;
  }

  private record(outcome: string): void {
    recordBusinessOutcome({
      operation: 'commerce.checkout_start',
      outcome,
    });
  }
}
