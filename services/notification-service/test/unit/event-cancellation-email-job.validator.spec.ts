import type { Message } from 'amqplib';
import { describe, expect, it } from 'vitest';

import {
  EVENT_CANCELLATION_EMAIL_JOB_MAX_BYTES,
  EVENT_CANCELLATION_EMAIL_JOB_TYPE,
} from '../../src/notifications/constants/cancellation-email.constants';
import { validateEventCancellationEmailJob } from '../../src/notifications/job-queue/cancellation/event-cancellation-email-job.validator';

const deliveryId = '87e8ebdb-4c98-46b5-908c-315c4eab5225';
const job = { deliveryId, type: EVENT_CANCELLATION_EMAIL_JOB_TYPE };

function message(
  payload: unknown = job,
  options: {
    content?: Buffer;
    properties?: Record<string, unknown>;
  } = {},
): Message {
  return {
    content: options.content ?? Buffer.from(JSON.stringify(payload)),
    fields: {},
    properties: { ...options.properties },
  } as unknown as Message;
}

describe('validateEventCancellationEmailJob', () => {
  it('accepts a relayed job that carries no AMQP properties', () => {
    expect(validateEventCancellationEmailJob(message())).toEqual({
      job,
      kind: 'valid',
    });
  });

  it('accepts a republished job that declares its content type and version', () => {
    expect(
      validateEventCancellationEmailJob(
        message(job, {
          properties: {
            contentType: 'application/json',
            messageId: deliveryId,
            type: EVENT_CANCELLATION_EMAIL_JOB_TYPE,
          },
        }),
      ),
    ).toEqual({ job, kind: 'valid' });
  });

  it('rejects a payload with an unexpected field', () => {
    expect(
      validateEventCancellationEmailJob(message({ ...job, unexpected: true })),
    ).toEqual({
      deliveryId,
      failureCode: 'JOB_FIELDS_INVALID',
      kind: 'invalid',
    });
  });

  it('rejects a payload without a delivery ID', () => {
    expect(
      validateEventCancellationEmailJob(
        message({ type: EVENT_CANCELLATION_EMAIL_JOB_TYPE }),
      ),
    ).toEqual({ failureCode: 'JOB_FIELDS_INVALID', kind: 'invalid' });
  });

  it('rejects a delivery ID that is not a UUID', () => {
    expect(
      validateEventCancellationEmailJob(
        message({ ...job, deliveryId: 'not-a-uuid' }),
      ),
    ).toEqual({ failureCode: 'JOB_ID_INVALID', kind: 'invalid' });
  });

  it('rejects an unknown job version', () => {
    expect(
      validateEventCancellationEmailJob(
        message({ ...job, type: 'notification.event-cancellation-email.v2' }),
      ),
    ).toEqual({
      deliveryId,
      failureCode: 'JOB_TYPE_INVALID',
      kind: 'invalid',
    });
  });

  it('rejects a payload that is not a JSON object', () => {
    expect(validateEventCancellationEmailJob(message([job]))).toEqual({
      failureCode: 'JOB_PAYLOAD_INVALID',
      kind: 'invalid',
    });
  });

  it('rejects unparseable content', () => {
    expect(
      validateEventCancellationEmailJob(
        message(undefined, { content: Buffer.from('{') }),
      ),
    ).toEqual({ failureCode: 'JOB_JSON_INVALID', kind: 'invalid' });
  });

  it('rejects a payload larger than the job size limit', () => {
    const oversized = Buffer.from(
      JSON.stringify({
        ...job,
        padding: 'x'.repeat(EVENT_CANCELLATION_EMAIL_JOB_MAX_BYTES),
      }),
    );

    expect(
      validateEventCancellationEmailJob(
        message(undefined, { content: oversized }),
      ),
    ).toEqual({
      deliveryId,
      failureCode: 'JOB_PAYLOAD_TOO_LARGE',
      kind: 'invalid',
    });
  });
});
