import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import {
  ADMIN_ACTIVATION_JOB_TYPE,
  ADMIN_ACTIVATION_QUEUE,
  type AdminActivationJob,
} from '@eventa/messaging-contracts/identity/admin-auth.jobs';
import { runWithOperationSpan } from '@eventa/observability';
import { context, propagation } from '@opentelemetry/api';

import type { RabbitMQClient } from '../../../infrastructure/clients/rabbitmq.client';
import { ADMIN_ACTIVATION_OTP_TTL_MS } from '../../constants/admin-activation.constants';
import type { AdminAuthJobPublisher } from '../../ports/admin-auth-job.publisher';
import type { AdminActivationOtp } from '../../types/admin-activation.types';

export class RabbitMQAdminAuthJobPublisher implements AdminAuthJobPublisher {
  constructor(
    private readonly rabbitMQ: RabbitMQClient,
    private readonly publishTimeoutMs: number,
  ) {}

  publishActivation(otp: AdminActivationOtp): Promise<void> {
    const job: AdminActivationJob = {
      expiresAt: new Date(
        Date.now() + ADMIN_ACTIVATION_OTP_TTL_MS,
      ).toISOString(),
      jobId: randomUUID(),
      otp: otp.otp,
      recipientEmail: otp.email,
      type: ADMIN_ACTIVATION_JOB_TYPE,
    };

    return runWithOperationSpan(
      'admin_activation_job.publish',
      () => this.publishConfirmed(job),
      {
        attributes: {
          'messaging.destination.name': ADMIN_ACTIVATION_QUEUE,
          'messaging.operation.name': 'publish',
          'messaging.system': 'rabbitmq',
        },
        kind: 'client',
      },
    );
  }

  private async publishConfirmed(job: AdminActivationJob): Promise<void> {
    const channel = await this.rabbitMQ.confirmChannel(
      'admin-auth-job-publisher',
    );
    await channel.assertQueue(ADMIN_ACTIVATION_QUEUE, {
      durable: true,
      arguments: {
        'x-delivery-limit': -1,
        'x-queue-type': 'quorum',
      },
    });
    const traceHeaders: Record<string, string> = {};
    propagation.inject(context.active(), traceHeaders);

    let timeout: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          channel.sendToQueue(
            ADMIN_ACTIVATION_QUEUE,
            Buffer.from(JSON.stringify(job)),
            {
              contentType: 'application/json',
              headers: traceHeaders,
              messageId: job.jobId,
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
                  : new Error('ADMIN_ACTIVATION_JOB_NOT_CONFIRMED'),
              );
            },
          );
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('ADMIN_ACTIVATION_JOB_CONFIRM_TIMEOUT')),
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
