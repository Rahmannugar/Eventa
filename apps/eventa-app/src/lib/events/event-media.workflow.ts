import type { EventMediaUploadStatus } from './event.types';

const DEFAULT_POLL_INTERVAL_MS = 1_500;

export class EventMediaVerificationTimedOutError extends Error {
  constructor() {
    super('EVENT_MEDIA_VERIFICATION_TIMED_OUT');
    this.name = 'EventMediaVerificationTimedOutError';
  }
}

interface WaitForEventMediaUploadOptions {
  readStatus: () => Promise<EventMediaUploadStatus>;
  signal: AbortSignal;
  now?: () => number;
  wait?: typeof waitForDelay;
}

export async function waitForEventMediaUpload({
  now = Date.now,
  readStatus,
  signal,
  wait = waitForDelay,
}: WaitForEventMediaUploadOptions): Promise<EventMediaUploadStatus> {
  while (true) {
    signal.throwIfAborted();
    const status = await readStatus();
    signal.throwIfAborted();
    if (status.status !== 'pending') return status;

    if (now() >= Date.parse(status.verificationDeadlineAt)) {
      throw new EventMediaVerificationTimedOutError();
    }
    await wait(DEFAULT_POLL_INTERVAL_MS, signal);
  }
}

function waitForDelay(durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, durationMs);
    const abort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException('Polling aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}
