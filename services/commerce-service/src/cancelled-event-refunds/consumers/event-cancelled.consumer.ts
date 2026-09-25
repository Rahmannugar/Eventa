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
import type { EachMessagePayload } from 'kafkajs';

import type { KafkaClient } from '../../infrastructure/clients/kafka.client';
import {
  CONSUMER_RETRY_MAX_MS,
  CONSUMER_RETRY_MIN_MS,
  EVENT_CANCELLED_OPERATION,
  SHUTDOWN_WAIT_MS,
} from '../constants/cancelled-event-refund.constants';
import type { EventCancellationRefundService } from '../services/event-cancellation-refund.service';
import { parseEventLifecycleFact } from './event-cancelled-fact';

const HEALTHY_RUN_RESET_MS = 60_000;
const TRACE_HEADERS = ['traceparent', 'tracestate', 'baggage'] as const;

export class EventCancelledConsumer
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(EventCancelledConsumer.name);
  private readonly topic: string;
  private shuttingDown = false;
  private subscribed = false;
  private loop: Promise<void> | undefined;

  constructor(
    private readonly kafka: KafkaClient,
    private readonly refunds: EventCancellationRefundService,
    topic: string,
  ) {
    this.topic = topic;
  }

  onModuleInit(): void {
    this.loop = this.consume();
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    await this.kafka.disconnect();
    if (this.loop === undefined) return;
    await Promise.race([
      this.loop.catch(() => undefined),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, SHUTDOWN_WAIT_MS);
        timer.unref();
      }),
    ]);
  }

  private async consume(): Promise<void> {
    let attempt = 0;
    while (!this.shuttingDown) {
      const consumer = this.kafka.consumer();
      let runStartedAt = 0;
      try {
        await consumer.connect();
        if (!this.subscribed) {
          await consumer.subscribe({ fromBeginning: true, topic: this.topic });
          this.subscribed = true;
        }
        runStartedAt = Date.now();
        await consumer.run({
          autoCommit: false,
          eachMessage: (payload) => this.handle(payload),
        });
        if (Date.now() - runStartedAt >= HEALTHY_RUN_RESET_MS) attempt = 0;
      } catch (error: unknown) {
        if (Date.now() - runStartedAt >= HEALTHY_RUN_RESET_MS) attempt = 0;
        attempt += 1;
        if (!this.shuttingDown) {
          this.logger.error({
            error_type: error instanceof Error ? error.name : 'UnknownError',
            event: 'event_cancelled_consumer_failed',
            operation: EVENT_CANCELLED_OPERATION,
            attempt,
          });
        }
      } finally {
        if (!this.shuttingDown) {
          await consumer.disconnect().catch(() => undefined);
        }
      }
      if (this.shuttingDown) return;
      if (runStartedAt === 0) attempt += 1;
      const delayMs = Math.min(
        CONSUMER_RETRY_MAX_MS,
        CONSUMER_RETRY_MIN_MS * 2 ** Math.min(attempt - 1, 5),
      );
      await this.delay(delayMs);
    }
  }

  private async handle(payload: EachMessagePayload): Promise<void> {
    const startedAt = process.hrtime.bigint();
    const { message, partition, topic } = payload;
    const parent = propagation.extract(
      context.active(),
      readTraceHeaders(message.headers),
    );
    addJobInFlight(1, { operation: EVENT_CANCELLED_OPERATION });
    try {
      const parsed = parseEventLifecycleFact(message.value);
      if (parsed.kind === 'foreign') {
        this.logger.log({
          event: 'event_lifecycle_fact_ignored',
          event_type: parsed.type,
          operation: EVENT_CANCELLED_OPERATION,
        });
        await this.commit(topic, partition, message.offset);
        this.recordJob(startedAt, 'ignored');
        return;
      }
      if (parsed.kind === 'rejected') {
        this.logger.error({
          event: 'event_cancelled_fact_rejected',
          operation: EVENT_CANCELLED_OPERATION,
        });
        this.recordJob(startedAt, 'rejected');
        throw new Error('EVENT_CANCELLED_FACT_REJECTED');
      }
      const outcome = await context.with(parent, () =>
        runWithOperationSpan(
          'event_cancelled_fact.process',
          () => this.refunds.handleCancellation(parsed.fact),
          {
            attributes: {
              'messaging.destination.name': topic,
              'messaging.operation.name': 'process',
              'messaging.system': 'kafka',
            },
            kind: 'consumer',
          },
        ),
      );
      await this.commit(topic, partition, message.offset);
      this.recordJob(startedAt, outcome);
    } finally {
      addJobInFlight(-1, { operation: EVENT_CANCELLED_OPERATION });
    }
  }

  private async commit(
    topic: string,
    partition: number,
    offset: string,
  ): Promise<void> {
    await this.kafka.consumer().commitOffsets([
      {
        offset: (BigInt(offset) + 1n).toString(),
        partition,
        topic,
      },
    ]);
  }

  private recordJob(startedAt: bigint, outcome: string): void {
    recordJobMetrics(Number(process.hrtime.bigint() - startedAt) / 1_000_000, {
      operation: EVENT_CANCELLED_OPERATION,
      outcome,
    });
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, milliseconds);
      timer.unref();
    });
  }
}

function readTraceHeaders(
  headers: EachMessagePayload['message']['headers'],
): Record<string, string> {
  if (headers === undefined) return {};
  const values: Record<string, string> = {};
  for (const name of TRACE_HEADERS) {
    const raw = headers[name];
    if (raw === undefined) continue;
    const entry = Array.isArray(raw) ? raw[0] : raw;
    if (entry === undefined) continue;
    const text = typeof entry === 'string' ? entry : entry.toString('utf8');
    if (text !== '') values[name] = text;
  }
  return values;
}
