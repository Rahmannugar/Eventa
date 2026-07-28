import { Buffer } from 'node:buffer';

import {
  ATTENDEE_PASSWORD_RESET_JOB_TYPE,
  ATTENDEE_PASSWORD_RESET_QUEUE,
  type AttendeePasswordResetJob,
} from '@eventa/messaging-contracts/identity/attendee-auth.jobs';
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

import type { RuntimeConfig } from '../../config/runtime-config';
import type { RabbitMQClient } from '../../infrastructure/clients/rabbitmq.client';
import {
  PASSWORD_RESET_CONSUMER_PREFETCH,
  PASSWORD_RESET_RETRY_DELAYS_MS,
} from '../constants/password-reset-delivery.constants';
import type { PasswordResetDeliveryService } from '../services/password-reset-delivery.service';
import type {
  PasswordResetDeliveryOutcome,
} from '../types/password-reset-delivery.types';
import { validateAttendeePasswordResetJob } from './attendee-password-reset-job.validator';

interface RetryQueue {
  delayMs: number;
  name: string;
}

type JobOutcome = PasswordResetDeliveryOutcome['kind'] | 'rejected';

const JOB_OPERATION = 'attendee.password_reset.delivery';

const RETRY_QUEUES: readonly RetryQueue[] =
  PASSWORD_RESET_RETRY_DELAYS_MS.map((delayMs) => ({
    delayMs,
    name: `${ATTENDEE_PASSWORD_RESET_QUEUE}.retry.${String(delayMs)}ms`,
  }));

export class PasswordResetJobConsumer
  implements OnApplicationShutdown, OnModuleInit
{
  private consumerChannel: Channel | undefined;
  private consumerTag: string | undefined;
  private readonly logger = new Logger(PasswordResetJobConsumer.name);
  private restartTimer: NodeJS.Timeout | undefined;
  private shuttingDown = false;

  constructor(
    private readonly rabbitMQ: RabbitMQClient,
    private readonly deliveryService: PasswordResetDeliveryService,
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
      'password-reset-job-consumer',
    );
    await this.assertTopology(channel);
    await channel.prefetch(PASSWORD_RESET_CONSUMER_PREFETCH);

    this.consumerChannel = channel;
    const reply = await channel.consume(
      ATTENDEE_PASSWORD_RESET_QUEUE,
      (message) => {
        if (message !== null) {
          void this.handleMessage(channel, message);
        }
      },
      { noAck: false },
    );

    this.consumerTag = reply.consumerTag;
    this.logger.log({
      event: 'password_reset_consumer_ready',
      prefetch: PASSWORD_RESET_CONSUMER_PREFETCH,
      queue_name: ATTENDEE_PASSWORD_RESET_QUEUE,
    });
    channel.once('close', () => this.scheduleRestart());
  }

  private async assertTopology(channel: Channel): Promise<void> {
    await channel.assertQueue(ATTENDEE_PASSWORD_RESET_QUEUE, {
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
          'x-dead-letter-routing-key': ATTENDEE_PASSWORD_RESET_QUEUE,
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

    addJobInFlight(1, { operation: JOB_OPERATION });

    try {
      while (!this.shuttingDown && this.consumerChannel === channel) {
        try {
          const outcome = await context.with(parentContext, () =>
            runWithOperationSpan(
              'password_reset_job.process',
              () => this.processMessage(channel, message),
              {
                attributes: {
                  'messaging.destination.name': ATTENDEE_PASSWORD_RESET_QUEUE,
                  'messaging.operation.name': 'process',
                  'messaging.system': 'rabbitmq',
                },
                kind: 'consumer',
              },
            ),
          );
          recordJobMetrics(
            Number(process.hrtime.bigint() - startedAt) / 1_000_000,
            { operation: JOB_OPERATION, outcome },
          );
          return;
        } catch (error: unknown) {
          this.logger.error({
            error_type: error instanceof Error ? error.name : 'UnknownError',
            event: 'password_reset_job_consumer_error',
          });
          await this.delay(1_000);
        }
      }
    } finally {
      addJobInFlight(-1, { operation: JOB_OPERATION });
    }
  }

  private async processMessage(
    channel: Channel,
    message: Message,
  ): Promise<JobOutcome> {
    const validation = validateAttendeePasswordResetJob(message);

    if (validation.kind === 'invalid') {
      if (validation.jobId !== undefined) {
        await this.deliveryService.recordRejected(
          validation.jobId,
          validation.failureCode,
        );
      }

      this.logger.error({
        error_code: validation.failureCode,
        event: 'password_reset_job_rejected',
        ...(validation.jobId === undefined
          ? {}
          : {
              job_id: validation.jobId,
              message_id: validation.jobId,
            }),
      });
      channel.ack(message);
      return 'rejected';
    }

    const outcome = await this.deliveryService.deliver(validation.job);

    if (outcome.kind === 'retry') {
      await this.publishRetry(validation.job, outcome);
      this.logger.log({
        event: 'password_reset_delivery_retry_scheduled',
        job_id: validation.job.jobId,
        message_id: validation.job.jobId,
        outcome: 'retry',
      });
      channel.ack(message);
      return 'retry';
    }

    this.logTerminalOutcome(validation.job.jobId, outcome);
    channel.ack(message);
    return outcome.kind;
  }

  private async publishRetry(
    job: AttendeePasswordResetJob,
    outcome: Extract<PasswordResetDeliveryOutcome, { kind: 'retry' }>,
  ): Promise<void> {
    const queue = this.selectRetryQueue(outcome.retryAt.getTime() - Date.now());

    await runWithOperationSpan(
      'password_reset_job.retry_publish',
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
    job: AttendeePasswordResetJob,
    queue: RetryQueue,
  ): Promise<void> {
    const channel = await this.rabbitMQ.confirmChannel(
      'password-reset-retry-publisher',
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
            messageId: job.jobId,
            persistent: true,
            timestamp: Date.now(),
            type: ATTENDEE_PASSWORD_RESET_JOB_TYPE,
          },
          (error: unknown) => {
            if (error === null || error === undefined) {
              resolve();
              return;
            }

            reject(
              error instanceof Error
                ? error
                : new Error('PASSWORD_RESET_RETRY_NOT_CONFIRMED'),
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
    jobId: string,
    outcome: Exclude<PasswordResetDeliveryOutcome, { kind: 'retry' }>,
  ): void {
    const fields = {
      event: 'password_reset_delivery_completed',
      job_id: jobId,
      message_id: jobId,
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
          event: 'password_reset_consumer_restart_failed',
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
            () => reject(new Error('PASSWORD_RESET_RETRY_CONFIRM_TIMEOUT')),
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
