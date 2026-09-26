import type { Message } from 'amqplib';
import { isUUID } from 'class-validator';

import {
  EVENT_CANCELLATION_EMAIL_JOB_MAX_BYTES,
  EVENT_CANCELLATION_EMAIL_JOB_TYPE,
} from '../../constants/cancellation-email.constants';
import type { CancellationEmailJob } from '../../types/cancellation-email.types';

export type CancellationEmailJobValidationResult =
  | { job: CancellationEmailJob; kind: 'valid' }
  | { deliveryId?: string; failureCode: string; kind: 'invalid' };

const EXPECTED_FIELDS = ['deliveryId', 'type'];

export function validateEventCancellationEmailJob(
  message: Message,
): CancellationEmailJobValidationResult {
  let payload: unknown;

  try {
    payload = JSON.parse(message.content.toString('utf8')) as unknown;
  } catch {
    return invalid('JOB_JSON_INVALID');
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return invalid('JOB_PAYLOAD_INVALID');
  }

  const record = payload as Record<string, unknown>;
  const deliveryId = knownDeliveryId(record.deliveryId);

  if (message.content.length > EVENT_CANCELLATION_EMAIL_JOB_MAX_BYTES) {
    return invalid('JOB_PAYLOAD_TOO_LARGE', deliveryId);
  }

  const fields = Object.keys(record).sort();

  if (
    fields.length !== EXPECTED_FIELDS.length ||
    fields.some((field, index) => field !== EXPECTED_FIELDS[index])
  ) {
    return invalid('JOB_FIELDS_INVALID', deliveryId);
  }

  if (deliveryId === undefined) {
    return invalid('JOB_ID_INVALID');
  }

  if (record.type !== EVENT_CANCELLATION_EMAIL_JOB_TYPE) {
    return invalid('JOB_TYPE_INVALID', deliveryId);
  }

  return {
    job: { deliveryId, type: EVENT_CANCELLATION_EMAIL_JOB_TYPE },
    kind: 'valid',
  };
}

function knownDeliveryId(value: unknown): string | undefined {
  return typeof value === 'string' && isUUID(value) ? value : undefined;
}

function invalid(
  failureCode: string,
  deliveryId?: string,
): CancellationEmailJobValidationResult {
  return {
    failureCode,
    ...(deliveryId === undefined ? {} : { deliveryId }),
    kind: 'invalid',
  };
}
