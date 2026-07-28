import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import {
  ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
  ATTENDEE_EMAIL_VERIFICATION_QUEUE,
  ATTENDEE_PASSWORD_RESET_JOB_TYPE,
  ATTENDEE_PASSWORD_RESET_QUEUE,
  type AttendeeEmailVerificationJob,
  type AttendeePasswordResetJob,
} from '@eventa/messaging-contracts/identity/attendee-auth.jobs';
import { runWithOperationSpan } from '@eventa/observability';
import { context, propagation } from '@opentelemetry/api';
import type { ConfirmChannel } from 'amqplib';

import type { RabbitMQClient } from '../../../infrastructure/clients/rabbitmq.client';
import { EMAIL_VERIFICATION_OTP_TTL_MS } from '../../constants/attendee-email-verification.constants';
import { PASSWORD_RESET_CODE_TTL_MS } from '../../constants/attendee-password-reset.constants';
import type { AttendeeAuthJobPublisher } from '../../ports/attendee-auth-job.publisher';
import type { EmailVerificationOtp } from '../../types/attendee-email-verification.types';
import type { PasswordResetCode } from '../../types/attendee-password-reset.types';

interface AuthJob {
  body: AttendeeEmailVerificationJob | AttendeePasswordResetJob;
  confirmTimeoutError: string;
  operation: string;
  queue: string;
  type: string;
}

export class RabbitMQAttendeeAuthJobPublisher implements AttendeeAuthJobPublisher {
  constructor(
    private readonly rabbitMQ: RabbitMQClient,
    private readonly publishTimeoutMs: number,
  ) {}

  publishEmailVerification(otp: EmailVerificationOtp): Promise<void> {
    const jobId = randomUUID();

    return this.publish({
      body: {
        expiresAt: new Date(
          Date.now() + EMAIL_VERIFICATION_OTP_TTL_MS,
        ).toISOString(),
        jobId,
        otp: otp.otp,
        recipientEmail: otp.email,
        type: ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
      },
      confirmTimeoutError: 'EMAIL_VERIFICATION_JOB_CONFIRM_TIMEOUT',
      operation: 'email_verification_job.publish',
      queue: ATTENDEE_EMAIL_VERIFICATION_QUEUE,
      type: ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
    });
  }

  publishPasswordReset(code: PasswordResetCode): Promise<void> {
    const jobId = randomUUID();

    return this.publish({
      body: {
        code: code.code,
        expiresAt: new Date(
          Date.now() + PASSWORD_RESET_CODE_TTL_MS,
        ).toISOString(),
        jobId,
        recipientEmail: code.email,
        type: ATTENDEE_PASSWORD_RESET_JOB_TYPE,
      },
      confirmTimeoutError: 'PASSWORD_RESET_JOB_CONFIRM_TIMEOUT',
      operation: 'password_reset_job.publish',
      queue: ATTENDEE_PASSWORD_RESET_QUEUE,
      type: ATTENDEE_PASSWORD_RESET_JOB_TYPE,
    });
  }

  private publish(job: AuthJob): Promise<void> {
    return runWithOperationSpan(
      job.operation,
      () => this.publishConfirmed(job),
      {
        attributes: {
          'messaging.destination.name': job.queue,
          'messaging.operation.name': 'publish',
          'messaging.system': 'rabbitmq',
        },
        kind: 'client',
      },
    );
  }

  private async publishConfirmed(job: AuthJob): Promise<void> {
    const channel = await this.rabbitMQ.confirmChannel(
      'attendee-auth-job-publisher',
    );
    await this.ensureQueue(channel, job.queue);
    const traceHeaders: Record<string, string> = {};
    propagation.inject(context.active(), traceHeaders);

    await this.withTimeout(
      new Promise<void>((resolve, reject) => {
        channel.sendToQueue(
          job.queue,
          Buffer.from(JSON.stringify(job.body)),
          {
            contentType: 'application/json',
            headers: traceHeaders,
            messageId: job.body.jobId,
            persistent: true,
            timestamp: Date.now(),
            type: job.type,
          },
          (error: unknown) => {
            if (error === null || error === undefined) {
              resolve();
              return;
            }

            reject(
              error instanceof Error
                ? error
                : new Error('ATTENDEE_AUTH_JOB_NOT_CONFIRMED'),
            );
          },
        );
      }),
      job.confirmTimeoutError,
    );
  }

  private ensureQueue(channel: ConfirmChannel, queue: string): Promise<unknown> {
    return channel.assertQueue(queue, {
      durable: true,
      arguments: {
        'x-delivery-limit': -1,
        'x-queue-type': 'quorum',
      },
    });
  }

  private async withTimeout(
    operation: Promise<void>,
    errorMessage: string,
  ): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(errorMessage)),
            this.publishTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }
}
