import { Buffer } from 'node:buffer';

import { context, propagation } from '@opentelemetry/api';
import type { ConfirmChannel } from 'amqplib';

import type { RuntimeConfig } from '../../../config/runtime-config';
import type { RabbitMQClient } from '../../../infrastructure/clients/rabbitmq.client';
import {
  EVENT_MEDIA_VERIFICATION_JOB_TYPE,
  EVENT_MEDIA_VERIFICATION_QUEUE,
} from '../../constants/event-media.constants';
import type { EventMediaVerificationJobPublisher } from '../../types/event.types';

export interface EventMediaVerificationJob {
  type: typeof EVENT_MEDIA_VERIFICATION_JOB_TYPE;
  uploadId: string;
}

export class RabbitMQEventMediaVerificationJobPublisher implements EventMediaVerificationJobPublisher {
  constructor(
    private readonly rabbitMQ: RabbitMQClient,
    private readonly config: RuntimeConfig,
  ) {}

  async publish(uploadId: string): Promise<void> {
    const channel = await this.rabbitMQ.confirmChannel(
      'event-media-verification-job-publisher',
    );
    await this.ensureTopology(channel);
    const traceHeaders: Record<string, string> = {};
    propagation.inject(context.active(), traceHeaders);
    const body: EventMediaVerificationJob = {
      type: EVENT_MEDIA_VERIFICATION_JOB_TYPE,
      uploadId,
    };

    await this.withTimeout(
      new Promise<void>((resolve, reject) => {
        channel.sendToQueue(
          EVENT_MEDIA_VERIFICATION_QUEUE,
          Buffer.from(JSON.stringify(body)),
          {
            contentType: 'application/json',
            headers: traceHeaders,
            messageId: uploadId,
            persistent: true,
            timestamp: Date.now(),
            type: EVENT_MEDIA_VERIFICATION_JOB_TYPE,
          },
          (error: unknown) => {
            if (error === null || error === undefined) resolve();
            else
              reject(
                error instanceof Error
                  ? error
                  : new Error('EVENT_MEDIA_JOB_NOT_CONFIRMED'),
              );
          },
        );
      }),
      this.config.rabbitMqPublishTimeoutMs,
    );
  }

  private async ensureTopology(channel: ConfirmChannel): Promise<void> {
    await channel.assertQueue(EVENT_MEDIA_VERIFICATION_QUEUE, {
      durable: true,
      arguments: { 'x-delivery-limit': -1, 'x-queue-type': 'quorum' },
    });
  }

  private async withTimeout(
    operation: Promise<void>,
    timeoutMs: number,
  ): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('EVENT_MEDIA_JOB_CONFIRM_TIMEOUT')),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}
