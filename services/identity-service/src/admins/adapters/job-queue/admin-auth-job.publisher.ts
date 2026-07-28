import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import {
  ADMIN_ACTIVATION_JOB_TYPE,
  ADMIN_ACTIVATION_QUEUE,
  ADMIN_PASSWORD_RESET_JOB_TYPE,
  ADMIN_PASSWORD_RESET_QUEUE,
  type AdminActivationJob,
  type AdminPasswordResetJob,
} from '@eventa/messaging-contracts/identity/admin-auth.jobs';
import { runWithOperationSpan } from '@eventa/observability';
import { context, propagation } from '@opentelemetry/api';
import type { ConfirmChannel } from 'amqplib';

import type { RabbitMQClient } from '../../../infrastructure/clients/rabbitmq.client';
import { ADMIN_ACTIVATION_OTP_TTL_MS } from '../../constants/admin-activation.constants';
import { ADMIN_PASSWORD_RESET_CODE_TTL_MS } from '../../constants/admin-password-reset.constants';
import type { AdminAuthJobPublisher } from '../../ports/admin-auth-job.publisher';
import type { AdminActivationOtp } from '../../types/admin-activation.types';
import type { AdminPasswordResetCode } from '../../types/admin-password-reset.types';

interface AdminAuthJob {
  body: AdminActivationJob | AdminPasswordResetJob;
  confirmTimeoutError: string;
  operation: string;
  queue: string;
  type: string;
}

export class RabbitMQAdminAuthJobPublisher implements AdminAuthJobPublisher {
  constructor(
    private readonly rabbitMQ: RabbitMQClient,
    private readonly publishTimeoutMs: number,
  ) {}

  publishActivation(otp: AdminActivationOtp): Promise<void> {
    return this.publish({
      body: {
        expiresAt: new Date(
          Date.now() + ADMIN_ACTIVATION_OTP_TTL_MS,
        ).toISOString(),
        jobId: randomUUID(),
        otp: otp.otp,
        recipientEmail: otp.email,
        type: ADMIN_ACTIVATION_JOB_TYPE,
      },
      confirmTimeoutError: 'ADMIN_ACTIVATION_JOB_CONFIRM_TIMEOUT',
      operation: 'admin_activation_job.publish',
      queue: ADMIN_ACTIVATION_QUEUE,
      type: ADMIN_ACTIVATION_JOB_TYPE,
    });
  }

  publishPasswordReset(code: AdminPasswordResetCode): Promise<void> {
    return this.publish({
      body: {
        code: code.code,
        expiresAt: new Date(
          Date.now() + ADMIN_PASSWORD_RESET_CODE_TTL_MS,
        ).toISOString(),
        jobId: randomUUID(),
        recipientEmail: code.email,
        type: ADMIN_PASSWORD_RESET_JOB_TYPE,
      },
      confirmTimeoutError: 'ADMIN_PASSWORD_RESET_JOB_CONFIRM_TIMEOUT',
      operation: 'admin_password_reset_job.publish',
      queue: ADMIN_PASSWORD_RESET_QUEUE,
      type: ADMIN_PASSWORD_RESET_JOB_TYPE,
    });
  }

  private publish(job: AdminAuthJob): Promise<void> {
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

  private async publishConfirmed(job: AdminAuthJob): Promise<void> {
    const channel = await this.rabbitMQ.confirmChannel(
      'admin-auth-job-publisher',
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
                : new Error('ADMIN_AUTH_JOB_NOT_CONFIRMED'),
            );
          },
        );
      }),
      job.confirmTimeoutError,
    );
  }

  private ensureQueue(
    channel: ConfirmChannel,
    queue: string,
  ): Promise<unknown> {
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
