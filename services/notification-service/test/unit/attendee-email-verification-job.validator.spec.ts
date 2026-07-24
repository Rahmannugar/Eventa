import {
  ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
  type AttendeeEmailVerificationJob,
} from '@eventa/messaging-contracts';
import type { Message } from 'amqplib';
import { describe, expect, it } from 'vitest';

import { validateAttendeeEmailVerificationJob } from '../../src/notifications/job-queue/attendee-email-verification-job.validator';

const job: AttendeeEmailVerificationJob = {
  expiresAt: '2026-07-23T12:15:00.000Z',
  jobId: '9f004a41-8ca1-46f4-b254-2d16dcc88520',
  otp: '123456',
  recipientEmail: 'attendee@example.com',
  type: ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
};

function message(
  payload: unknown = job,
  properties: Record<string, unknown> = {},
): Message {
  return {
    content: Buffer.from(JSON.stringify(payload)),
    fields: {},
    properties: {
      contentType: 'application/json',
      messageId: job.jobId,
      type: ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
      ...properties,
    },
  } as Message;
}

describe('validateAttendeeEmailVerificationJob', () => {
  it('accepts the exact versioned payload and matching AMQP properties', () => {
    expect(validateAttendeeEmailVerificationJob(message())).toEqual({
      job,
      kind: 'valid',
    });
  });

  it.each([
    ['an extra field', { ...job, unexpected: true }, 'JOB_FIELDS_INVALID'],
    ['a malformed OTP', { ...job, otp: '12345' }, 'JOB_OTP_INVALID'],
    [
      'a noncanonical expiry',
      { ...job, expiresAt: '2026-07-23T12:15:00Z' },
      'JOB_EXPIRY_INVALID',
    ],
    [
      'a mismatched version',
      { ...job, type: 'attendee.email-verification.v2' },
      'JOB_TYPE_INVALID',
    ],
  ])('rejects %s', (_, payload, failureCode) => {
    expect(validateAttendeeEmailVerificationJob(message(payload))).toEqual({
      failureCode,
      jobId: job.jobId,
      kind: 'invalid',
    });
  });

  it('rejects a payload whose job ID differs from the broker message ID', () => {
    expect(
      validateAttendeeEmailVerificationJob(
        message(job, {
          messageId: '8d47611a-e0d3-4c04-959f-aa2257e22183',
        }),
      ),
    ).toEqual({
      failureCode: 'JOB_ID_MISMATCH',
      jobId: '8d47611a-e0d3-4c04-959f-aa2257e22183',
      kind: 'invalid',
    });
  });
});
