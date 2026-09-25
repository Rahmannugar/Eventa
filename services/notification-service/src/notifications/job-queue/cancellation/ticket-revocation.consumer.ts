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
import type { Consumer, EachMessagePayload } from 'kafkajs';

import type { KafkaClient } from '../../../infrastructure/clients/kafka.client';
import {
  CONSUMER_RETRY_MAX_MS,
  CONSUMER_RETRY_MIN_MS,
  EVENT_CANCELLATION_EMAIL_OPERATION,
  SHUTDOWN_WAIT_MS,
} from '../../constants/cancellation-email.constants';
import type { CancellationEmailIngestService } from '../../services/cancellation-email-ingest.service';
import { parseTicketRevokedFact } from './ticket-revocation-fact';

const HEALTHY_RUN_RESET_MS = 60_000;
const TRACE_HEADERS = ['traceparent', 'tracestate', 'baggage'] as const;

export class TicketRevocationConsumer
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(TicketRevocationConsumer.name);
  private readonly topic: string;
  private readonly shutdownSignal: Promise<void>;
  private readonly signalShutdown: () => void;
  private shuttingDown = false;
  private subscribed = false;
  private loop: Promise<void> | undefined;

  constructor(
    private readonly kafka: KafkaClient,
    private readonly ingest: CancellationEmailIngestService,
    topic: string,
  ) {
    this.topic = topic;
    let signalShutdown: () => void = () => undefined;
    this.shutdownSignal = new Promise<void>((resolve) => {
      signalShutdown = resolve;
    });
    this.signalShutdown = signalShutdown;
  }

  onModuleInit(): void {
    this.loop = this.consume();
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    this.signalShutdown();
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
      let connected = false;
      try {
        await consumer.connect();
        connected = true;
        if (!this.subscribed) {
          await consumer.subscribe({ fromBeginning: true, topic: this.topic });
          this.subscribed = true;
        }
        const unrecoverable = this.watchForUnrecoverableCrash(consumer);
        runStartedAt = Date.now();
        await consumer.run({
          autoCommit: false,
          eachMessage: (payload) => this.handle(payload),
        });
        // run() resolves once the group is joined and fetching starts, so the
        // consumer stays subscribed until shutdown or a crash kafkajs cannot
        // restart on its own.
        await Promise.race([unrecoverable, this.shutdownSignal]);
        if (this.shuttingDown) return;
      } catch (error: unknown) {
        if (!this.shuttingDown) {
          this.logger.error({
            error_type: error instanceof Error ? error.name : 'UnknownError',
            event: 'ticket_revocation_consumer_failed',
            operation: EVENT_CANCELLATION_EMAIL_OPERATION,
            attempt: attempt + 1,
          });
        }
      } finally {
        if (!this.shuttingDown && connected) {
          await consumer.disconnect().catch(() => undefined);
        }
      }
      const healthy =
        runStartedAt !== 0 && Date.now() - runStartedAt >= HEALTHY_RUN_RESET_MS;
      attempt = healthy ? 0 : attempt + 1;
      if (this.shuttingDown) return;
      const delayMs = Math.min(
        CONSUMER_RETRY_MAX_MS,
        CONSUMER_RETRY_MIN_MS * 2 ** Math.min(Math.max(attempt, 1) - 1, 5),
      );
      await this.delay(delayMs);
    }
  }

  private watchForUnrecoverableCrash(consumer: Consumer): Promise<void> {
    return new Promise<void>((resolve) => {
      consumer.on(consumer.events.CRASH, (event) => {
        if (event.payload.restart !== true) resolve();
      });
    });
  }

  private async handle(payload: EachMessagePayload): Promise<void> {
    const startedAt = process.hrtime.bigint();
    const { message, partition, topic } = payload;
    const parent = propagation.extract(
      context.active(),
      readTraceHeaders(message.headers),
    );
    addJobInFlight(1, { operation: EVENT_CANCELLATION_EMAIL_OPERATION });
    try {
      const parsed = parseTicketRevokedFact(message.value);
      if (parsed.kind === 'foreign') {
        this.logger.log({
          event: 'ticket_revocation_fact_ignored',
          event_type: parsed.type,
          operation: EVENT_CANCELLATION_EMAIL_OPERATION,
        });
        await this.commit(topic, partition, message.offset);
        this.recordJob(startedAt, 'ignored');
        return;
      }
      if (parsed.kind === 'rejected') {
        this.logger.error({
          event: 'ticket_revocation_fact_rejected',
          operation: EVENT_CANCELLATION_EMAIL_OPERATION,
        });
        this.recordJob(startedAt, 'rejected');
        throw new Error('TICKET_REVOKED_FACT_REJECTED');
      }
      const outcome = await context.with(parent, () =>
        runWithOperationSpan(
          'ticket_revocation_fact.process',
          () => this.ingest.handleRevocation(parsed.fact),
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
      addJobInFlight(-1, { operation: EVENT_CANCELLATION_EMAIL_OPERATION });
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
      operation: EVENT_CANCELLATION_EMAIL_OPERATION,
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
