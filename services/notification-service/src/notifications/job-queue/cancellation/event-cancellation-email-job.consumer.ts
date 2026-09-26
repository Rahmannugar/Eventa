import { Buffer } from 'node:buffer';

import {
  addJobInFlight,
  recordJobMetrics,
  runWithOperationSpan,
} from '@eventa/observability';
import {
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { context, propagation } from '@opentelemetry/api';
import type { Channel, Message } from 'amqplib';

import type { RuntimeConfig } from '../../../config/runtime-config';
import type { RabbitMQClient } from '../../../infrastructure/clients/rabbitmq.client';
import {
  EVENT_CANCELLATION_EMAIL_CONSUMER_PREFETCH,
  EVENT_CANCELLATION_EMAIL_DELIVERY_OPERATION,
  EVENT_CANCELLATION_EMAIL_JOB_TYPE,
  EVENT_CANCELLATION_EMAIL_QUEUE,
  EVENT_CANCELLATION_EMAIL_RETRY_DELAYS_MS,
} from '../../constants/cancellation-email.constants';
import type { CancellationEmailDeliveryService } from '../../services/cancellation-email-delivery.service';
import type { CancellationEmailDeliveryOutcome } from '../../types/cancellation-email.types';
import { validateEventCancellationEmailJob } from './event-cancellation-email-job.validator';

interface RetryQueue {
  delayMs: number;
  name: string;
}

type JobProcessingOutcome =
  CancellationEmailDeliveryOutcome['kind'] | 'rejected';

const RETRY_QUEUES: readonly RetryQueue[] =
  EVENT_CANCELLATION_EMAIL_RETRY_DELAYS_MS.map((delayMs) => ({
    delayMs,
    name: `${EVENT_CANCELLATION_EMAIL_QUEUE}.retry.${String(delayMs)}ms`,
  }));

export class EventCancellationEmailJobConsumer
  implements OnApplicationShutdown, OnModuleInit
{
  private consumerChannel: Channel | undefined;
  private consumerTag: string | undefined;
  private readonly logger = new Logger(EventCancellationEmailJobConsumer.name);
  private restartTimer: NodeJS.Timeout | undefined;
  private shuttingDown = false;

  constructor(
    private readonly rabbitMQ: RabbitMQClient,
    private readonly deliveryService: CancellationEmailDeliveryService,
    private readonly config: RuntimeConfig,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.startConsumer();
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;

    if (this.restartTimer !== undefined) {
      clearTimeout(this.restartTimer);
    }

    if (this.consumerChannel !== undefined && this.consumerTag !== undefined) {
      await this.consumerChannel
        .cancel(this.consumerTag)
        .catch(() => undefined);
    }
  }

  private async startConsumer(): Promise<void> {
    const channel = await this.rabbitMQ.consumerChannel(
      'event-cancellation-email-job-consumer',
    );
    await this.assertTopology(channel);
    await channel.prefetch(EVENT_CANCELLATION_EMAIL_CONSUMER_PREFETCH);

    this.consumerChannel = channel;
    const reply = await channel.consume(
      EVENT_CANCELLATION_EMAIL_QUEUE,
      (message) => {
        if (message !== null) {
          void this.handleMessage(channel, message);
        }
      },
      { noAck: false },
    );

    this.consumerTag = reply.consumerTag;
    this.logger.log({
      event: 'event_cancellation_email_consumer_ready',
      prefetch: EVENT_CANCELLATION_EMAIL_CONSUMER_PREFETCH,
      queue_name: EVENT_CANCELLATION_EMAIL_QUEUE,
    });
    channel.once('close', () => this.scheduleRestart());
  }

  private async assertTopology(channel: Channel): Promise<void> {
    await channel.assertQueue(EVENT_CANCELLATION_EMAIL_QUEUE, {
      durable: true,
      arguments: {
        'x-delivery-limit': -1,
        'x-queue-type': 'quorum',
      },
    });

    for (const retryQueue of RETRY_QUEUES) {
      await channel.assertQueue(retryQueue.name, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': EVENT_CANCELLATION_EMAIL_QUEUE,
          'x-dead-letter-strategy': 'at-least-once',
          'x-message-ttl': retryQueue.delayMs,
          'x-overflow': 'reject-publish',
          'x-queue-type': 'quorum',
        },
      });
    }
  }

  private async handleMessage(
    channel: Channel,
    message: Message,
  ): Promise<void> {
    const startedAt = process.hrtime.bigint();
    const parentContext = propagation.extract(
      context.active(),
      this.readTraceHeaders(message),
    );

    addJobInFlight(1, {
      operation: EVENT_CANCELLATION_EMAIL_DELIVERY_OPERATION,
    });

    try {
      while (!this.shuttingDown && this.consumerChannel === channel) {
        try {
          const outcome = await context.with(parentContext, () =>
            runWithOperationSpan(
              'cancellation_email_job.process',
              () => this.processMessage(channel, message),
              {
                attributes: {
                  'messaging.destination.name': EVENT_CANCELLATION_EMAIL_QUEUE,
                  'messaging.operation.name': 'process',
                  'messaging.system': 'rabbitmq',
                },
                kind: 'consumer',
              },
            ),
          );
          const durationMilliseconds =
            Number(process.hrtime.bigint() - startedAt) / 1_000_000;
          recordJobMetrics(durationMilliseconds, {
            operation: EVENT_CANCELLATION_EMAIL_DELIVERY_OPERATION,
            outcome,
          });
          return;
        } catch (error: unknown) {
          this.logger.error({
            error_type: error instanceof Error ? error.name : 'UnknownError',
            event: 'event_cancellation_email_job_consumer_error',
            operation: EVENT_CANCELLATION_EMAIL_DELIVERY_OPERATION,
          });
          await this.delay(1_000);
        }
      }
    } finally {
      addJobInFlight(-1, {
        operation: EVENT_CANCELLATION_EMAIL_DELIVERY_OPERATION,
      });
    }
  }

  private async processMessage(
    channel: Channel,
    message: Message,
  ): Promise<JobProcessingOutcome> {
    const validation = validateEventCancellationEmailJob(message);

    if (validation.kind === 'invalid') {
      if (validation.deliveryId !== undefined) {
        await this.deliveryService.recordRejected(
          validation.deliveryId,
          validation.failureCode,
        );
      }

      this.logger.error({
        error_code: validation.failureCode,
        event: 'event_cancellation_email_job_rejected',
        operation: EVENT_CANCELLATION_EMAIL_DELIVERY_OPERATION,
        ...(validation.deliveryId === undefined
          ? {}
          : { delivery_id: validation.deliveryId }),
      });
      channel.ack(message);
      return 'rejected';
    }

    const outcome = await this.deliveryService.deliver(validation.job);

    if (outcome.kind === 'retry') {
      await this.publishRetry(validation.job, outcome);
      this.logger.log({
        event: 'event_cancellation_email_delivery_retry_scheduled',
        delivery_id: validation.job.deliveryId,
        operation: EVENT_CANCELLATION_EMAIL_DELIVERY_OPERATION,
        outcome: 'retry',
      });
      channel.ack(message);
      return 'retry';
    }

    this.logTerminalOutcome(validation.job.deliveryId, outcome);
    channel.ack(message);
    return outcome.kind;
  }

  private async publishRetry(
    job: { deliveryId: string; type: string },
    outcome: Extract<CancellationEmailDeliveryOutcome, { kind: 'retry' }>,
  ): Promise<void> {
    const queue = this.selectRetryQueue(outcome.retryAt.getTime() - Date.now());

    await runWithOperationSpan(
      'cancellation_email_job.retry_publish',
      () => this.publishRetryConfirmed(job, queue),
      {
        attributes: {
          'messaging.destination.name': queue.name,
          'messaging.operation.name': 'publish',
          'messaging.system': 'rabbitmq',
        },
        kind: 'producer',
      },
    );
  }

  private async publishRetryConfirmed(
    job: { deliveryId: string; type: string },
    queue: RetryQueue,
  ): Promise<void> {
    const channel = await this.rabbitMQ.confirmChannel(
      'event-cancellation-email-retry-publisher',
    );
    const traceHeaders: Record<string, string> = {};
    propagation.inject(context.active(), traceHeaders);

    await this.withTimeout(
      new Promise<void>((resolve, reject) => {
        channel.sendToQueue(
          queue.name,
          Buffer.from(JSON.stringify(job)),
          {
            contentType: 'application/json',
            headers: traceHeaders,
            messageId: job.deliveryId,
            persistent: true,
            timestamp: Date.now(),
            type: EVENT_CANCELLATION_EMAIL_JOB_TYPE,
          },
          (error: unknown) => {
            if (error === null || error === undefined) {
              resolve();
              return;
            }

            reject(
              error instanceof Error
                ? error
                : new Error('EVENT_CANCELLATION_EMAIL_RETRY_NOT_CONFIRMED'),
            );
          },
        );
      }),
      this.config.rabbitMqPublishTimeoutMs,
    );
  }

  private async delay(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  private selectRetryQueue(delayMs: number): RetryQueue {
    return (
      RETRY_QUEUES.find((queue) => delayMs <= queue.delayMs) ??
      RETRY_QUEUES.at(-1)!
    );
  }

  private logTerminalOutcome(
    deliveryId: string,
    outcome: Exclude<CancellationEmailDeliveryOutcome, { kind: 'retry' }>,
  ): void {
    const fields = {
      delivery_id: deliveryId,
      event: 'event_cancellation_email_delivery_completed',
      operation: EVENT_CANCELLATION_EMAIL_DELIVERY_OPERATION,
      outcome: outcome.kind,
    };

    if (outcome.kind === 'failed' || outcome.kind === 'rejected') {
      this.logger.error(fields);
      return;
    }

    this.logger.log(fields);
  }

  private readTraceHeaders(message: Message): Record<string, string> {
    const rawHeaders = message.properties.headers as unknown;

    if (typeof rawHeaders !== 'object' || rawHeaders === null) {
      return {};
    }

    const headers: Record<string, string> = {};

    for (const name of ['traceparent', 'tracestate', 'baggage']) {
      const value = Reflect.get(rawHeaders, name) as unknown;

      if (typeof value === 'string') {
        headers[name] = value;
      }
    }

    return headers;
  }

  private scheduleRestart(): void {
    this.consumerChannel = undefined;
    this.consumerTag = undefined;

    if (this.shuttingDown || this.restartTimer !== undefined) {
      return;
    }

    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      void this.startConsumer().catch((error: unknown) => {
        this.logger.error({
          error_type: error instanceof Error ? error.name : 'UnknownError',
          event: 'event_cancellation_email_consumer_restart_failed',
        });
        this.scheduleRestart();
      });
    }, 1_000);
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
              reject(
                new Error('EVENT_CANCELLATION_EMAIL_RETRY_CONFIRM_TIMEOUT'),
              ),
            timeoutMs,
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
