import { afterEach, describe, expect, it, vi } from 'vitest';

import type { KafkaClient } from '../../src/infrastructure/clients/kafka.client';
import { EventCancelledConsumer } from '../../src/cancelled-event-refunds/consumers/event-cancelled.consumer';
import type { EventCancellationRefundService } from '../../src/cancelled-event-refunds/services/event-cancellation-refund.service';

const TOPIC = 'eventa.event.lifecycle.v1';
const CRASH = 'consumer.crash';

function createConsumer(): {
  consumer: Record<string, unknown>;
  calls: { connect: number; disconnect: number; run: number };
  emitCrash: (restart: boolean) => void;
} {
  const calls = { connect: 0, disconnect: 0, run: 0 };
  const listeners: Array<(event: unknown) => void> = [];
  const consumer = {
    events: { CRASH },
    connect: () => {
      calls.connect += 1;
      return Promise.resolve();
    },
    subscribe: () => Promise.resolve(),
    run: () => {
      calls.run += 1;
      return Promise.resolve();
    },
    disconnect: () => {
      calls.disconnect += 1;
      return Promise.resolve();
    },
    commitOffsets: () => Promise.resolve(),
    on: (_name: string, listener: (event: unknown) => void) => {
      listeners.push(listener);
      return () => undefined;
    },
  };
  return {
    consumer,
    calls,
    emitCrash: (restart: boolean) => {
      for (const listener of listeners) listener({ payload: { restart } });
    },
  };
}

function createKafkaClient(
  consumer: Record<string, unknown>,
): KafkaClient & { disconnects: () => number } {
  let disconnects = 0;
  const kafka = {
    consumer: () => consumer,
    disconnect: () => {
      disconnects += 1;
      return Promise.resolve();
    },
    onApplicationShutdown: () => Promise.resolve(),
    disconnects: () => disconnects,
  };
  return kafka as unknown as KafkaClient & { disconnects: () => number };
}

function createRefunds(): EventCancellationRefundService {
  return {
    handleCancellation: vi.fn(),
    ensureOrderClaimed: vi.fn(),
  } as unknown as EventCancellationRefundService;
}

async function settle(milliseconds = 25): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe('EventCancelledConsumer run loop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the consumer connected after the group join resolves', async () => {
    const { consumer, calls } = createConsumer();
    const kafka = createKafkaClient(consumer);
    const subject = new EventCancelledConsumer(kafka, createRefunds(), TOPIC);

    subject.onModuleInit();
    await settle();

    expect(calls.run).toBe(1);
    expect(calls.disconnect).toBe(0);

    await subject.onApplicationShutdown();
  });

  it('reconnects after a crash kafkajs cannot restart itself', async () => {
    const { consumer, calls, emitCrash } = createConsumer();
    const kafka = createKafkaClient(consumer);
    const subject = new EventCancelledConsumer(kafka, createRefunds(), TOPIC);

    subject.onModuleInit();
    await settle();
    expect(calls.connect).toBe(1);

    emitCrash(false);

    await vi.waitFor(() => expect(calls.connect).toBe(2), { timeout: 4_000 });
    expect(calls.disconnect).toBe(1);

    await subject.onApplicationShutdown();
  });

  it('releases the consume loop during shutdown', async () => {
    const { consumer, calls } = createConsumer();
    const kafka = createKafkaClient(consumer);
    const subject = new EventCancelledConsumer(kafka, createRefunds(), TOPIC);

    subject.onModuleInit();
    await settle();

    await subject.onApplicationShutdown();

    expect(calls.disconnect).toBe(0);
    expect(kafka.disconnects()).toBe(1);
    await settle();
    expect(calls.run).toBe(1);
  });
});
