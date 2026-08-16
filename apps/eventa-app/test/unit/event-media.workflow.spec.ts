import { describe, expect, it, vi } from 'vitest';

import {
  EventMediaVerificationTimedOutError,
  waitForEventMediaUpload,
} from '../../src/lib/events/event-media.workflow';
import type { EventMediaUploadStatus } from '../../src/lib/events/event.types';

function uploadStatus(
  status: EventMediaUploadStatus['status'],
): EventMediaUploadStatus {
  return {
    expiresAt: '2026-08-16T12:10:00.000Z',
    slot: 'cover',
    status,
    uploadId: '148fc84b-640a-4f62-9248-46b04e8b68fe',
    verificationDeadlineAt: '2026-08-16T12:30:00.000Z',
  };
}

describe('event media verification polling', () => {
  it('stops when the image is attached', async () => {
    const readStatus = vi
      .fn<() => Promise<EventMediaUploadStatus>>()
      .mockResolvedValueOnce(uploadStatus('pending'))
      .mockResolvedValueOnce({
        ...uploadStatus('attached'),
        attachedEventVersion: 2,
      });
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await waitForEventMediaUpload({
      now: () => Date.parse('2026-08-16T12:00:00.000Z'),
      readStatus,
      signal: new AbortController().signal,
      wait,
    });

    expect(result.status).toBe('attached');
    expect(readStatus).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
  });

  it('returns rejected without another poll', async () => {
    const readStatus = vi.fn().mockResolvedValue(uploadStatus('rejected'));
    const wait = vi.fn().mockResolvedValue(undefined);

    const result = await waitForEventMediaUpload({
      readStatus,
      signal: new AbortController().signal,
      wait,
    });

    expect(result.status).toBe('rejected');
    expect(wait).not.toHaveBeenCalled();
  });

  it('stops pending verification at its deadline', async () => {
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      waitForEventMediaUpload({
        now: () => Date.parse('2026-08-16T12:30:00.000Z'),
        readStatus: vi.fn().mockResolvedValue(uploadStatus('pending')),
        signal: new AbortController().signal,
        wait,
      }),
    ).rejects.toBeInstanceOf(EventMediaVerificationTimedOutError);
    expect(wait).not.toHaveBeenCalled();
  });
});
