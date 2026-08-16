import { Buffer } from 'node:buffer';

import { context, propagation } from '@opentelemetry/api';
import type { RuntimeConfig } from '../../../config/runtime-config';
import type { RabbitMQClient } from '../../../infrastructure/clients/rabbitmq.client';
import {
  EVENT_MEDIA_JOB_EXCHANGE,
  EVENT_MEDIA_OBJECT_DELETION_JOB_TYPE,
  EVENT_MEDIA_OBJECT_DELETION_QUEUE,
} from '../../constants/event-media.constants';
import type { EventMediaObjectDeletionJobPublisher } from '../../types/event.types';

interface EventMediaObjectDeletionJob {
  type: typeof EVENT_MEDIA_OBJECT_DELETION_JOB_TYPE;
  deletionId: string;
}

export class RabbitMQEventMediaObjectDeletionJobPublisher implements EventMediaObjectDeletionJobPublisher {
  constructor(
    private readonly rabbitMQ: RabbitMQClient,
    private readonly config: RuntimeConfig,
  ) {}

  async publish(deletionId: string): Promise<void> {
    const channel = await this.rabbitMQ.confirmChannel(
      'event-media-object-deletion-job-publisher',
    );
    await channel.assertExchange(EVENT_MEDIA_JOB_EXCHANGE, 'direct', {
      durable: true,
    });
    await channel.assertQueue(EVENT_MEDIA_OBJECT_DELETION_QUEUE, {
      durable: true,
      arguments: { 'x-delivery-limit': -1, 'x-queue-type': 'quorum' },
    });
    await channel.bindQueue(
      EVENT_MEDIA_OBJECT_DELETION_QUEUE,
      EVENT_MEDIA_JOB_EXCHANGE,
      EVENT_MEDIA_OBJECT_DELETION_QUEUE,
    );
    const traceHeaders: Record<string, string> = {};
    propagation.inject(context.active(), traceHeaders);
    const body: EventMediaObjectDeletionJob = {
      deletionId,
      type: EVENT_MEDIA_OBJECT_DELETION_JOB_TYPE,
    };

    await this.withTimeout(
      new Promise<void>((resolve, reject) => {
        channel.publish(
          EVENT_MEDIA_JOB_EXCHANGE,
          EVENT_MEDIA_OBJECT_DELETION_QUEUE,
          Buffer.from(JSON.stringify(body)),
          {
            contentType: 'application/json',
            headers: traceHeaders,
            messageId: deletionId,
            persistent: true,
            timestamp: Date.now(),
            type: EVENT_MEDIA_OBJECT_DELETION_JOB_TYPE,
          },
          (error: unknown) => {
            if (error === null || error === undefined) resolve();
            else
              reject(
                error instanceof Error
                  ? error
                  : new Error('EVENT_MEDIA_OBJECT_DELETION_NOT_CONFIRMED'),
              );
          },
        );
      }),
      this.config.rabbitMqPublishTimeoutMs,
    );
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
            () =>
              reject(new Error('EVENT_MEDIA_OBJECT_DELETION_CONFIRM_TIMEOUT')),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}
