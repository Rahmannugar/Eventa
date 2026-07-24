import {
  ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
  type AttendeeEmailVerificationJob,
} from '@eventa/messaging-contracts';
import type { Message } from 'amqplib';
import { isEmail, isUUID } from 'class-validator';

import { EMAIL_VERIFICATION_JOB_MAX_BYTES } from '../constants/email-verification-delivery.constants';

interface SafeMessageProperties {
  contentType?: unknown;
  messageId?: unknown;
  type?: unknown;
}

export type EmailVerificationJobValidationResult =
  | {
      job: AttendeeEmailVerificationJob;
      kind: 'valid';
    }
  | {
      failureCode: string;
      jobId?: string;
      kind: 'invalid';
    };

export function validateAttendeeEmailVerificationJob(
  message: Message,
): EmailVerificationJobValidationResult {
  const properties = message.properties as unknown as SafeMessageProperties;
  const propertyJobId =
    typeof properties.messageId === 'string' &&
    isUUID(properties.messageId, '4')
      ? properties.messageId
      : undefined;

  if (message.content.length > EMAIL_VERIFICATION_JOB_MAX_BYTES) {
    return invalid('JOB_PAYLOAD_TOO_LARGE', propertyJobId);
  }

  if (properties.contentType !== 'application/json') {
    return invalid('JOB_CONTENT_TYPE_INVALID', propertyJobId);
  }

  if (properties.type !== ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE) {
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

  if (type !== ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE) {
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
    job: {
      expiresAt,
      jobId,
      otp,
      recipientEmail,
      type,
    },
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
): EmailVerificationJobValidationResult {
  return {
    failureCode,
    ...(jobId === undefined ? {} : { jobId }),
    kind: 'invalid',
  };
}
