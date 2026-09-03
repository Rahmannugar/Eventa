import { describe, expect, it, vi } from 'vitest';

import { TicketPurchaseExpiryService } from '../../src/ticket-purchase/services/ticket-purchase-expiry.service';

const order = {
  orderId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  eventId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  ticketTypeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
};

const payment = {
  paymentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  providerPaymentIntentId: 'pi_test',
  status: 'processing' as const,
};

describe('TicketPurchaseExpiryService', () => {
  it('leaves capacity untouched when the provider is already successful', async () => {
    const release = vi.fn();
    const service = new TicketPurchaseExpiryService(
      { claimExpired: vi.fn().mockResolvedValue([order]), markExpired: vi.fn(), releaseExpiryClaim: vi.fn() } as never,
      { findByOrderId: vi.fn().mockResolvedValue(payment) } as never,
      { retrieveIntent: vi.fn().mockResolvedValue({ status: 'succeeded' }) } as never,
      { release } as never,
    );

    await expect(service.process()).resolves.toBe(1);
    expect(release).not.toHaveBeenCalled();
  });

  it('cancels a non-terminal provider intent before releasing capacity', async () => {
    const cancelIntent = vi.fn().mockResolvedValue({ status: 'canceled' });
    const release = vi.fn().mockResolvedValue({ status: 'released' });
    const markExpired = vi.fn().mockResolvedValue(undefined);
    const service = new TicketPurchaseExpiryService(
      { claimExpired: vi.fn().mockResolvedValue([order]), markExpired, releaseExpiryClaim: vi.fn() } as never,
      { findByOrderId: vi.fn().mockResolvedValue(payment) } as never,
      { retrieveIntent: vi.fn().mockResolvedValue({ status: 'requires_action' }), cancelIntent } as never,
      { release } as never,
    );

    await expect(service.process()).resolves.toBe(1);
    expect(cancelIntent).toHaveBeenCalledWith(payment.providerPaymentIntentId);
    expect(release).toHaveBeenCalledOnce();
    expect(markExpired).toHaveBeenCalledWith(order.orderId);
  });
});
