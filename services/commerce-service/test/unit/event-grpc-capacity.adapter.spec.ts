import {
  EventCapacityReservationStatus,
  type EventServiceClient,
} from '@eventa/grpc-contracts';
import type { Metadata } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { EventGrpcCapacityAdapter } from '../../src/ticket-purchase/adapters/event-grpc-capacity.adapter';

const input = {
  attendeeId: '53f24606-184d-4c2f-bd68-9e27a9e034e9',
  eventId: 'c0caa9fc-6f69-4118-ad7f-110d872da987',
  quantity: 2,
  requestId: 'checkout-request',
  reservationId: 'e0caa9fc-6f69-4118-ad7f-110d872da987',
  ticketTypeId: 'd0caa9fc-6f69-4118-ad7f-110d872da987',
};

type ReserveCall = (
  request: unknown,
  metadata: Metadata,
  options: { deadline: Date },
) => ReturnType<EventServiceClient['reserveEventCapacity']>;

function createAdapter(
  reserveEventCapacity: ReserveCall,
): EventGrpcCapacityAdapter {
  const grpc = {
    getService: () => ({ reserveEventCapacity }),
  } as unknown as ClientGrpc;
  const adapter = new EventGrpcCapacityAdapter(grpc, 2_000);
  adapter.onModuleInit();
  return adapter;
}

function reservation() {
  return {
    attendeeId: input.attendeeId,
    createdAt: new Date().toISOString(),
    currency: 'NGN',
    eventId: input.eventId,
    expiresAt: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
    quantity: input.quantity,
    reservationId: input.reservationId,
    status:
      EventCapacityReservationStatus.EVENT_CAPACITY_RESERVATION_STATUS_ACTIVE,
    ticketName: 'Standard',
    ticketTypeId: input.ticketTypeId,
    unitPriceMinor: 2_500,
    updatedAt: new Date().toISOString(),
  };
}

describe('EventGrpcCapacityAdapter', () => {
  it('forwards reservation identity, request correlation, and a bounded deadline', async () => {
    const startedAt = Date.now();
    let metadata: Metadata | undefined;
    let deadline: Date | undefined;
    const adapter = createAdapter((request, received, options) => {
      expect(request).toMatchObject({
        attendeeId: input.attendeeId,
        reservationId: input.reservationId,
      });
      metadata = received;
      deadline = options.deadline;
      return of({ reservation: reservation() });
    });

    await expect(adapter.reserve(input)).resolves.toMatchObject({
      currency: 'NGN',
      reservationId: input.reservationId,
      unitPriceMinor: 2_500,
    });
    expect(metadata?.get('x-request-id')).toEqual([input.requestId]);
    expect(deadline?.getTime()).toBeGreaterThanOrEqual(startedAt + 1_900);
    expect(deadline?.getTime()).toBeLessThanOrEqual(Date.now() + 2_000);
  });

  it('rejects a reservation response that does not match the requested work', async () => {
    const adapter = createAdapter(() =>
      of({
        reservation: {
          ...reservation(),
          attendeeId: 'another-attendee',
        },
      }),
    );

    await expect(adapter.reserve(input)).rejects.toThrow(
      'EVENT_CAPACITY_RESERVATION_INVALID_RESPONSE',
    );
  });
});
