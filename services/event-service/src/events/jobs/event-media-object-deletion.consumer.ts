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

import type { RabbitMQClient } from '../../infrastructure/clients/rabbitmq.client';
import {
  EVENT_MEDIA_CONSUMER_PREFETCH,
  EVENT_MEDIA_OBJECT_DELETION_JOB_TYPE,
  EVENT_MEDIA_OBJECT_DELETION_OPERATION,
  EVENT_MEDIA_OBJECT_DELETION_QUEUE,
} from '../constants/event-media.constants';
import type { EventMediaObjectDeletionService } from '../services/event-media-object-deletion.service';

export class EventMediaObjectDeletionConsumer
  implements OnModuleInit, OnApplicationShutdown
{
  private channel: Channel | undefined;
  private consumerTag: string | undefined;
  private readonly logger = new Logger(EventMediaObjectDeletionConsumer.name);
  private restartTimer: NodeJS.Timeout | undefined;
  private shuttingDown = false;

  constructor(
    private readonly rabbitMQ: RabbitMQClient,
    private readonly deletions: EventMediaObjectDeletionService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer);
    if (this.channel !== undefined && this.consumerTag !== undefined) {
      await this.channel.cancel(this.consumerTag).catch(() => undefined);
    }
  }

  private async start(): Promise<void> {
    const channel = await this.rabbitMQ.consumerChannel(
      'event-media-object-deletion-job-consumer',
    );
    await channel.assertQueue(EVENT_MEDIA_OBJECT_DELETION_QUEUE, {
      durable: true,
      arguments: { 'x-delivery-limit': -1, 'x-queue-type': 'quorum' },
    });
    await channel.prefetch(EVENT_MEDIA_CONSUMER_PREFETCH);
    this.channel = channel;
    const reply = await channel.consume(
      EVENT_MEDIA_OBJECT_DELETION_QUEUE,
      (message) => {
        if (message !== null) void this.handle(channel, message);
      },
      { noAck: false },
    );
    this.consumerTag = reply.consumerTag;
    this.logger.log({
      event: 'event_media_object_deletion_consumer_ready',
      prefetch: EVENT_MEDIA_CONSUMER_PREFETCH,
      queue_name: EVENT_MEDIA_OBJECT_DELETION_QUEUE,
    });
    channel.once('close', () => this.scheduleRestart());
  }

  private async handle(channel: Channel, message: Message): Promise<void> {
    const startedAt = process.hrtime.bigint();
    const parent = propagation.extract(
      context.active(),
      this.readTraceHeaders(message),
    );
    addJobInFlight(1, { operation: EVENT_MEDIA_OBJECT_DELETION_OPERATION });
    try {
      while (!this.shuttingDown && this.channel === channel) {
        try {
          const outcome = await context.with(parent, () =>
            runWithOperationSpan(
              'event_media_object_deletion_job.process',
              () => this.process(channel, message),
              {
                attributes: {
                  'messaging.destination.name':
                    EVENT_MEDIA_OBJECT_DELETION_QUEUE,
                  'messaging.operation.name': 'process',
                  'messaging.system': 'rabbitmq',
                },
                kind: 'consumer',
              },
            ),
          );
          recordJobMetrics(
            Number(process.hrtime.bigint() - startedAt) / 1_000_000,
            { operation: EVENT_MEDIA_OBJECT_DELETION_OPERATION, outcome },
          );
          return;
        } catch (error: unknown) {
          this.logger.error({
            error_type: error instanceof Error ? error.name : 'UnknownError',
            event: 'event_media_object_deletion_consumer_error',
            operation: EVENT_MEDIA_OBJECT_DELETION_OPERATION,
          });
          await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
        }
      }
    } finally {
      addJobInFlight(-1, { operation: EVENT_MEDIA_OBJECT_DELETION_OPERATION });
    }
  }

  private async process(channel: Channel, message: Message): Promise<string> {
    const deletionId = this.validate(message);
    if (deletionId === undefined) {
      this.logger.error({
        event: 'event_media_object_deletion_job_rejected',
        operation: EVENT_MEDIA_OBJECT_DELETION_OPERATION,
      });
      channel.ack(message);
      return 'rejected';
    }

    const outcome = await this.deletions.delete(deletionId);
    if (outcome.kind === 'retry') {
      channel.ack(message);
      return 'retry';
    }

    const fields = {
      deletion_id: deletionId,
      event: 'event_media_object_deletion_completed',
      job_id: deletionId,
      message_id: deletionId,
      operation: EVENT_MEDIA_OBJECT_DELETION_OPERATION,
      outcome: outcome.kind,
    };
    if (outcome.kind === 'object_deletion_failed') this.logger.error(fields);
    else this.logger.log(fields);
    channel.ack(message);
    return outcome.kind;
  }

  private validate(message: Message): string | undefined {
    try {
      if (
        message.properties.contentType !== 'application/json' ||
        message.properties.type !== EVENT_MEDIA_OBJECT_DELETION_JOB_TYPE
      ) {
        return undefined;
      }
      const value: unknown = JSON.parse(
        Buffer.from(message.content).toString('utf8'),
      );
      if (typeof value !== 'object' || value === null) return undefined;
      const deletionId = Reflect.get(value, 'deletionId') as unknown;
      const type = Reflect.get(value, 'type') as unknown;
      return type === EVENT_MEDIA_OBJECT_DELETION_JOB_TYPE &&
        typeof deletionId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          deletionId,
        )
        ? deletionId
        : undefined;
    } catch {
      return undefined;
    }
  }

  private readTraceHeaders(message: Message): Record<string, string> {
    const raw = message.properties.headers as unknown;
    if (typeof raw !== 'object' || raw === null) return {};
    const headers: Record<string, string> = {};
    for (const name of ['traceparent', 'tracestate', 'baggage']) {
      const value = Reflect.get(raw, name) as unknown;
      if (typeof value === 'string') headers[name] = value;
    }
    return headers;
  }

  private scheduleRestart(): void {
    this.channel = undefined;
    this.consumerTag = undefined;
    if (this.shuttingDown || this.restartTimer !== undefined) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      void this.start().catch((error: unknown) => {
        this.logger.error({
          error_type: error instanceof Error ? error.name : 'UnknownError',
          event: 'event_media_object_deletion_consumer_restart_failed',
        });
        this.scheduleRestart();
      });
    }, 1_000);
  }
}
