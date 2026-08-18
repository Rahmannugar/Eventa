import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EventWaitlistPromotion } from '../../src/events/jobs/event-waitlist-promotion';
import type { EventWaitlistRepository } from '../../src/events/types/event.types';

describe('EventWaitlistPromotion', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('continues after one ticket type fails', async () => {
    vi.useFakeTimers();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const promote = vi
      .fn<EventWaitlistRepository['promote']>()
      .mockRejectedValueOnce(new Error('promotion failed'))
      .mockResolvedValueOnce(1);
    const waitlist = {
      find: vi.fn(),
      findPromotionCandidates: vi
        .fn<EventWaitlistRepository['findPromotionCandidates']>()
        .mockResolvedValue([
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002',
        ]),
      join: vi.fn(),
      leave: vi.fn(),
      promote,
    } satisfies EventWaitlistRepository;
    const worker = new EventWaitlistPromotion(waitlist);

    worker.onModuleInit();
    await vi.advanceTimersByTimeAsync(1_000);
    worker.onModuleDestroy();

    expect(promote).toHaveBeenNthCalledWith(
      1,
      '00000000-0000-4000-8000-000000000001',
      100,
    );
    expect(promote).toHaveBeenNthCalledWith(
      2,
      '00000000-0000-4000-8000-000000000002',
      100,
    );
  });
});
