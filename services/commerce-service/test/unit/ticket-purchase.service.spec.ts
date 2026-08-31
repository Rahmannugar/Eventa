import { describe, expect, it, vi } from 'vitest';

import type { OrderRepository } from '../../src/orders/repositories/order.repository';
import type {
  CommerceOrderRecord,
  CommerceOrderRepository,
} from '../../src/orders/types/order.types';
import type { PaymentManagement } from '../../src/payments/types/payment-attempt.types';
import { TicketPurchaseService } from '../../src/ticket-purchase/services/ticket-purchase.service';
import type { EventCapacityPort } from '../../src/ticket-purchase/types/event-capacity.port';

const input = {
  attendeeId: '53f24606-184d-4c2f-bd68-9e27a9e034e9',
  eventId: 'c0caa9fc-6f69-4118-ad7f-110d872da987',
  idempotencyKey: 'e0caa9fc-6f69-4118-ad7f-110d872da987',
  quantity: 2,
  requestId: 'checkout-request',
  ticketTypeId: 'd0caa9fc-6f69-4118-ad7f-110d872da987',
};

function pending(
  status: CommerceOrderRecord['status'] = 'pending_reservation',
): CommerceOrderRecord {
  const payable = status === 'pending_payment';
  return {
    attendeeId: input.attendeeId,
    createdAt: new Date('2026-08-26T10:00:00.000Z'),
    eventId: input.eventId,
    failureCode: null,
    idempotencyKey: input.idempotencyKey,
    orderId: 'f0caa9fc-6f69-4118-ad7f-110d872da987',
    requestedQuantity: input.quantity,
    reservationExpiresAt: payable ? new Date('2099-08-26T10:10:00.000Z') : null,
    status,
    ticketTypeId: input.ticketTypeId,
    totalMinor: payable ? 5000 : null,
    updatedAt: new Date('2026-08-26T10:00:00.000Z'),
    currency: payable ? 'NGN' : null,
  };
}

function createService(
  createPending: CommerceOrderRepository['createPending'],
  reserve: EventCapacityPort['reserve'],
  markReserved: CommerceOrderRepository['markReserved'],
  prepare: PaymentManagement['prepare'] = vi.fn().mockResolvedValue({
    clientSecret: 'payment-secret',
    paymentId: '25cb26ef-73fa-4e59-85fc-11d67d0205f3',
  }),
): TicketPurchaseService {
  return new TicketPurchaseService(
    { createPending, markReserved } as unknown as OrderRepository,
    { reserve },
    { prepare },
  );
}

describe('TicketPurchaseService', () => {
  it('reserves capacity with the order ID and applies the returned quote', async () => {
    const order = pending();
    const reserve = vi.fn<EventCapacityPort['reserve']>().mockResolvedValue({
      attendeeId: input.attendeeId,
      currency: 'NGN',
      eventId: input.eventId,
      expiresAt: new Date('2099-08-26T10:10:00.000Z'),
      quantity: 2,
      reservationId: order.orderId,
      ticketName: 'Standard',
      ticketTypeId: input.ticketTypeId,
      unitPriceMinor: 2500,
    });
    const markReserved = vi
      .fn<CommerceOrderRepository['markReserved']>()
      .mockResolvedValue({
        ...order,
        currency: 'NGN',
        reservationExpiresAt: new Date('2099-08-26T10:10:00.000Z'),
        status: 'pending_payment',
        totalMinor: 5000,
      });
    const service = createService(
      vi.fn().mockResolvedValue(order),
      reserve,
      markReserved,
    );

    await expect(service.start(input)).resolves.toMatchObject({
      order: { status: 'pending_payment' },
      payment: { paymentId: '25cb26ef-73fa-4e59-85fc-11d67d0205f3' },
    });
    expect(reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: order.orderId,
        requestId: input.requestId,
      }),
    );
    expect(markReserved).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: 'NGN',
        totalMinor: 5000,
        unitPriceMinor: 2500,
      }),
    );
  });

  it('returns a pending-payment order without reserving capacity again', async () => {
    const order = pending('pending_payment');
    const reserve = vi.fn<EventCapacityPort['reserve']>();
    const service = createService(
      vi.fn().mockResolvedValue(order),
      reserve,
      vi.fn(),
    );

    await expect(service.start(input)).resolves.toMatchObject({ order });
    expect(reserve).not.toHaveBeenCalled();
  });

  it('does not advance the order when capacity reservation fails', async () => {
    const order = pending();
    const reserve = vi
      .fn<EventCapacityPort['reserve']>()
      .mockRejectedValue(new Error('EVENT_TICKET_CAPACITY_UNAVAILABLE'));
    const markReserved = vi.fn<CommerceOrderRepository['markReserved']>();
    const service = createService(
      vi.fn().mockResolvedValue(order),
      reserve,
      markReserved,
    );

    await expect(service.start(input)).rejects.toThrow(
      'EVENT_TICKET_CAPACITY_UNAVAILABLE',
    );
    expect(markReserved).not.toHaveBeenCalled();
  });

  it('does not reserve capacity again after payment preparation fails', async () => {
    const order = pending('pending_payment');
    const reserve = vi.fn<EventCapacityPort['reserve']>();
    const prepare = vi
      .fn<PaymentManagement['prepare']>()
      .mockRejectedValue(new Error('PAYMENT_PROVIDER_UNAVAILABLE'));
    const service = createService(
      vi.fn().mockResolvedValue(order),
      reserve,
      vi.fn(),
      prepare,
    );

    await expect(service.start(input)).rejects.toThrow(
      'PAYMENT_PROVIDER_UNAVAILABLE',
    );
    expect(reserve).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: order.orderId }),
    );
  });
});
