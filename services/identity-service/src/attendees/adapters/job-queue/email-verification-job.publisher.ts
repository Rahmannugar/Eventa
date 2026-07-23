import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import {
  ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
  ATTENDEE_EMAIL_VERIFICATION_QUEUE,
  type AttendeeEmailVerificationJob,
} from '@eventa/messaging-contracts';
import { runWithOperationSpan } from '@eventa/observability';
import { context, propagation } from '@opentelemetry/api';

import type { RabbitMQClient } from '../../../infrastructure/clients/rabbitmq.client';
import { EMAIL_VERIFICATION_OTP_TTL_MS } from '../../constants/attendee-email-verification.constants';
import type { EmailVerificationJobPublisher } from '../../ports/email-verification-job.publisher';
import type { EmailVerificationOtpIssue } from '../../types/attendee-email-verification.types';

export class RabbitMQEmailVerificationJobPublisher implements EmailVerificationJobPublisher {
  constructor(
    private readonly rabbitMQ: RabbitMQClient,
    private readonly publishTimeoutMs: number,
  ) {}

  async publish(issue: EmailVerificationOtpIssue): Promise<void> {
    return runWithOperationSpan(
      'email_verification_job.publish',
      () => this.publishConfirmed(issue),
      {
        attributes: {
          'messaging.destination.name': ATTENDEE_EMAIL_VERIFICATION_QUEUE,
          'messaging.operation.name': 'publish',
          'messaging.system': 'rabbitmq',
        },
        kind: 'client',
      },
    );
  }

  private async publishConfirmed(
    issue: EmailVerificationOtpIssue,
  ): Promise<void> {
    const channel = await this.rabbitMQ.confirmChannel(
      'email-verification-job-publisher',
    );
    await channel.assertQueue(ATTENDEE_EMAIL_VERIFICATION_QUEUE, {
      durable: true,
      arguments: {
        'x-queue-type': 'quorum',
      },
    });

    const jobId = randomUUID();
    const expiresAt = new Date(
      Date.now() + EMAIL_VERIFICATION_OTP_TTL_MS,
    ).toISOString();
    const job: AttendeeEmailVerificationJob = {
      expiresAt,
      jobId,
      otp: issue.otp,
      recipientEmail: issue.email,
      type: ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
    };
    const traceHeaders: Record<string, string> = {};
    propagation.inject(context.active(), traceHeaders);

    await this.withTimeout(
      new Promise<void>((resolve, reject) => {
        channel.sendToQueue(
          ATTENDEE_EMAIL_VERIFICATION_QUEUE,
          Buffer.from(JSON.stringify(job)),
          {
            contentType: 'application/json',
            expiration: String(EMAIL_VERIFICATION_OTP_TTL_MS),
            headers: traceHeaders,
            messageId: jobId,
            persistent: true,
            timestamp: Date.now(),
            type: ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
          },
          (error: unknown) => {
            if (error === null || error === undefined) {
              resolve();
              return;
            }

            reject(
              error instanceof Error
                ? error
                : new Error('EMAIL_VERIFICATION_JOB_NOT_CONFIRMED'),
            );
          },
        );
      }),
      this.publishTimeoutMs,
      'EMAIL_VERIFICATION_JOB_CONFIRM_TIMEOUT',
    );
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    message: string,
  ): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}
