import {
  CommerceOrderStatus,
  type CommerceOrder,
} from '@eventa/grpc-contracts';
import { status, type Metadata } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { CommerceOrderService } from '../../src/domains/commerce/services/commerce-order.service';
import type { DeadlineAwareCommerceClient } from '../../src/domains/commerce/types/commerce-grpc-client.types';

const attendeeId = '53f24606-184d-4c2f-bd68-9e27a9e034e9';
const order: CommerceOrder = {
  attendeeId,
  createdAt: '2026-08-26T10:00:00.000Z',
  eventId: 'c0caa9fc-6f69-4118-ad7f-110d872da987',
  orderId: 'e0caa9fc-6f69-4118-ad7f-110d872da987',
  quantity: 2,
  status: CommerceOrderStatus.COMMERCE_ORDER_STATUS_PENDING_PAYMENT,
  ticketTypeId: 'd0caa9fc-6f69-4118-ad7f-110d872da987',
  totalMinor: 5000,
  currency: 'NGN',
  reservationExpiresAt: '2026-08-26T10:10:00.000Z',
  updatedAt: '2026-08-26T10:01:00.000Z',
};

function createService(
  client: Partial<DeadlineAwareCommerceClient>,
  deadlineMs = 5_000,
): CommerceOrderService {
  const grpc = { getService: () => client } as unknown as ClientGrpc;
  const service = new CommerceOrderService(grpc, deadlineMs);
  service.onModuleInit();
  return service;
}

describe('CommerceOrderService', () => {
  it('forwards attendee identity, correlation, and deadline', async () => {
    let metadata: Metadata | undefined;
    const start = (
      request: unknown,
      received: Metadata,
      options: { deadline: Date },
    ) => {
      expect(request).toMatchObject({ attendeeId, quantity: 2 });
      metadata = received;
      expect(options.deadline.getTime()).toBeGreaterThan(Date.now());
      return of({ order });
    };
    const result = await createService({
      startTicketPurchase: start,
    }).start(
      {
        eventId: order.eventId,
        ticketTypeId: order.ticketTypeId,
        idempotencyKey: order.orderId,
        quantity: 2,
      },
      attendeeId,
      'checkout-request',
    );
    expect(result.status).toBe('pending_payment');
    expect(metadata?.get('x-request-id')).toEqual(['checkout-request']);
  });

  it('maps conflicting idempotency reuse to a public conflict', async () => {
    const service = createService({
      startTicketPurchase: () =>
        throwError(() => ({ code: status.ALREADY_EXISTS })),
    });
    await expect(
      service.start(
        {
          eventId: order.eventId,
          ticketTypeId: order.ticketTypeId,
          idempotencyKey: order.orderId,
          quantity: 2,
        },
        attendeeId,
        'checkout-request',
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: { code: 'CHECKOUT_IDEMPOTENCY_CONFLICT' },
    });
  });

  it('rejects a malformed commerce order response', async () => {
    const service = createService({
      getCommerceOrder: () =>
        of({ order: { ...order, attendeeId: 'different' } }),
    });
    await expect(
      service.get(order.orderId, attendeeId, 'checkout-request'),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: 'COMMERCE_ORDER_RESPONSE_INVALID' },
    });
  });
});
