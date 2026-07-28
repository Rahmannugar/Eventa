import {
  ADMIN_ACTIVATION_JOB_TYPE,
  type AdminActivationJob,
} from '@eventa/messaging-contracts/identity/admin-auth.jobs';
import type { Message } from 'amqplib';
import { isEmail, isUUID } from 'class-validator';

import { ADMIN_ACTIVATION_JOB_MAX_BYTES } from '../constants/admin-activation-delivery.constants';

interface SafeMessageProperties {
  contentType?: unknown;
  messageId?: unknown;
  type?: unknown;
}

export type AdminActivationJobValidationResult =
  | { job: AdminActivationJob; kind: 'valid' }
  | { failureCode: string; jobId?: string; kind: 'invalid' };

export function validateAdminActivationJob(
  message: Message,
): AdminActivationJobValidationResult {
  const properties = message.properties as unknown as SafeMessageProperties;
  const propertyJobId =
    typeof properties.messageId === 'string' &&
    isUUID(properties.messageId, '4')
      ? properties.messageId
      : undefined;

  if (message.content.length > ADMIN_ACTIVATION_JOB_MAX_BYTES) {
    return invalid('JOB_PAYLOAD_TOO_LARGE', propertyJobId);
  }

  if (properties.contentType !== 'application/json') {
    return invalid('JOB_CONTENT_TYPE_INVALID', propertyJobId);
  }

  if (properties.type !== ADMIN_ACTIVATION_JOB_TYPE) {
    return invalid('JOB_PROPERTY_TYPE_INVALID', propertyJobId);
  }

  let payload: unknown;

  try {
    payload = JSON.parse(message.content.toString('utf8')) as unknown;
  } catch {
    return invalid('JOB_JSON_INVALID', propertyJobId);
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return invalid('JOB_PAYLOAD_INVALID', propertyJobId);
  }

  const fields = Object.keys(payload).sort();
  const expectedFields = [
    'expiresAt',
    'jobId',
    'otp',
    'recipientEmail',
    'type',
  ];

  if (
    fields.length !== expectedFields.length ||
    fields.some((field, index) => field !== expectedFields[index])
  ) {
    return invalid('JOB_FIELDS_INVALID', propertyJobId);
  }

  const record = payload as Record<string, unknown>;
  const expiresAt = record.expiresAt;
  const jobId = record.jobId;
  const otp = record.otp;
  const recipientEmail = record.recipientEmail;
  const type = record.type;

  if (typeof jobId !== 'string' || !isUUID(jobId, '4')) {
    return invalid('JOB_ID_INVALID', propertyJobId);
  }

  if (propertyJobId !== jobId) {
    return invalid('JOB_ID_MISMATCH', propertyJobId);
  }

  if (type !== ADMIN_ACTIVATION_JOB_TYPE) {
    return invalid('JOB_TYPE_INVALID', jobId);
  }

  if (
    typeof recipientEmail !== 'string' ||
    recipientEmail.length > 320 ||
    !isEmail(recipientEmail)
  ) {
    return invalid('JOB_RECIPIENT_INVALID', jobId);
  }

  if (typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
    return invalid('JOB_OTP_INVALID', jobId);
  }

  if (!isCanonicalIsoTimestamp(expiresAt)) {
    return invalid('JOB_EXPIRY_INVALID', jobId);
  }

  return {
    job: { expiresAt, jobId, otp, recipientEmail, type },
    kind: 'valid',
  };
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const timestamp = new Date(value);
  return (
    !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value
  );
}

function invalid(
  failureCode: string,
  jobId?: string,
): AdminActivationJobValidationResult {
  return {
    failureCode,
    ...(jobId === undefined ? {} : { jobId }),
    kind: 'invalid',
  };
}
