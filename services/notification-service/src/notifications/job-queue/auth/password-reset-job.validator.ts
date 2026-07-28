import {
  ATTENDEE_PASSWORD_RESET_JOB_TYPE,
  type AttendeePasswordResetJob,
} from '@eventa/messaging-contracts/identity/attendee-auth.jobs';
import {
  ADMIN_PASSWORD_RESET_JOB_TYPE,
  type AdminPasswordResetJob,
} from '@eventa/messaging-contracts/identity/admin-auth.jobs';
import type { Message } from 'amqplib';
import { isEmail, isUUID } from 'class-validator';

import { PASSWORD_RESET_JOB_MAX_BYTES } from '../../constants/password-reset-delivery.constants';

interface SafeMessageProperties {
  contentType?: unknown;
  messageId?: unknown;
  type?: unknown;
}

export type PasswordResetJobValidationResult =
  | {
      job: AttendeePasswordResetJob | AdminPasswordResetJob;
      kind: 'valid';
    }
  | {
      failureCode: string;
      jobId?: string;
      kind: 'invalid';
    };

type PasswordResetJobType =
  | typeof ADMIN_PASSWORD_RESET_JOB_TYPE
  | typeof ATTENDEE_PASSWORD_RESET_JOB_TYPE;

export function validatePasswordResetJob(
  message: Message,
  expectedType: PasswordResetJobType,
): PasswordResetJobValidationResult {
  const properties = message.properties as unknown as SafeMessageProperties;
  const propertyJobId =
    typeof properties.messageId === 'string' &&
    isUUID(properties.messageId, '4')
      ? properties.messageId
      : undefined;

  if (message.content.length > PASSWORD_RESET_JOB_MAX_BYTES) {
    return invalid('JOB_PAYLOAD_TOO_LARGE', propertyJobId);
  }

  if (properties.contentType !== 'application/json') {
    return invalid('JOB_CONTENT_TYPE_INVALID', propertyJobId);
  }

  if (properties.type !== expectedType) {
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
    'code',
    'expiresAt',
    'jobId',
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
  const code = record.code;
  const expiresAt = record.expiresAt;
  const jobId = record.jobId;
  const recipientEmail = record.recipientEmail;
  const type = record.type;

  if (typeof jobId !== 'string' || !isUUID(jobId, '4')) {
    return invalid('JOB_ID_INVALID', propertyJobId);
  }

  if (propertyJobId !== jobId) {
    return invalid('JOB_ID_MISMATCH', propertyJobId);
  }

  if (type !== expectedType) {
    return invalid('JOB_TYPE_INVALID', jobId);
  }

  if (
    typeof recipientEmail !== 'string' ||
    recipientEmail.length > 320 ||
    !isEmail(recipientEmail)
  ) {
    return invalid('JOB_RECIPIENT_INVALID', jobId);
  }

  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return invalid('JOB_CODE_INVALID', jobId);
  }

  if (!isCanonicalIsoTimestamp(expiresAt)) {
    return invalid('JOB_EXPIRY_INVALID', jobId);
  }

  const shared = { code, expiresAt, jobId, recipientEmail };

  return expectedType === ADMIN_PASSWORD_RESET_JOB_TYPE
    ? {
        job: { ...shared, type: ADMIN_PASSWORD_RESET_JOB_TYPE },
        kind: 'valid',
      }
    : {
        job: { ...shared, type: ATTENDEE_PASSWORD_RESET_JOB_TYPE },
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
): PasswordResetJobValidationResult {
  return {
    failureCode,
    ...(jobId === undefined ? {} : { jobId }),
    kind: 'invalid',
  };
}
