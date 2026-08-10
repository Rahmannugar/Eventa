import type { OnModuleDestroy } from '@nestjs/common';
import { Kafka, logLevel, type Producer } from 'kafkajs';

export class KafkaClient implements OnModuleDestroy {
  private readonly producer: Producer;
  private connected = false;

  constructor(
    brokers: string[],
    clientId: string,
    connectionTimeoutMs: number,
    requestTimeoutMs: number,
  ) {
    this.producer = new Kafka({
      brokers,
      clientId,
      connectionTimeout: connectionTimeoutMs,
      logLevel: logLevel.NOTHING,
      requestTimeout: requestTimeoutMs,
    }).producer({ idempotent: true, maxInFlightRequests: 1 });
  }

  async publish(topic: string, key: string, value: string): Promise<void> {
    if (!this.connected) {
      await this.producer.connect();
      this.connected = true;
    }

    await this.producer.send({
      acks: -1,
      messages: [{ key, value }],
      topic,
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.connected) {
      await this.producer.disconnect();
      this.connected = false;
    }
  }
}
