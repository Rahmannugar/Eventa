export const EVENT_MEDIA_MAX_SIZE_BYTES = 8 * 1024 * 1024;
export const EVENT_MEDIA_UPLOAD_TTL_MS = 10 * 60 * 1_000;
export const EVENT_MEDIA_VERIFICATION_TTL_MS = 30 * 60 * 1_000;
export const EVENT_MEDIA_CLAIM_LEASE_MS = 30 * 1_000;
export const EVENT_MEDIA_DISPATCH_INTERVAL_MS = 500;
export const EVENT_MEDIA_DISPATCH_LEASE_MS = 30_000;
export const EVENT_MEDIA_DISPATCH_BATCH_SIZE = 50;
export const EVENT_MEDIA_CONSUMER_PREFETCH = 8;
export const EVENT_MEDIA_JOB_EXCHANGE = 'eventa.event.jobs';
export const EVENT_MEDIA_MAX_OBJECT_DELETION_ATTEMPTS = 10;
export const EVENT_MEDIA_MAX_INPUT_PIXELS = 40_000_000;
export const EVENT_MEDIA_VERIFICATION_QUEUE =
  'eventa.event.media-verification.v1';
export const EVENT_MEDIA_VERIFICATION_JOB_TYPE = 'event.media-verification.v1';
export const EVENT_MEDIA_VERIFICATION_OPERATION = 'event.media.verification';
export const EVENT_MEDIA_OBJECT_DELETION_QUEUE =
  'eventa.event.media-object-deletion.v1';
export const EVENT_MEDIA_OBJECT_DELETION_JOB_TYPE =
  'event.media-object-deletion.v1';
export const EVENT_MEDIA_OBJECT_DELETION_OPERATION =
  'event.media.object_deletion';
export const EVENT_MEDIA_RETRY_DELAYS_MS = [
  1_000, 1_000, 2_000, 3_000, 5_000, 10_000, 15_000, 30_000, 60_000,
] as const;

export const EVENT_MEDIA_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export const EVENT_MEDIA_SLOTS = [
  'cover',
  'gallery_1',
  'gallery_2',
  'gallery_3',
  'gallery_4',
] as const;
