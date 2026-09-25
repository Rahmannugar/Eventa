import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Kafka, logLevel, type Consumer, type KafkaConfig } from 'kafkajs';

export interface KafkaClientOptions {
  brokers: string[];
  clientId: string;
  consumerGroup: string;
}

export class KafkaClient implements OnApplicationShutdown {
  private readonly consumerGroup: string;
  private readonly kafka: Kafka;
  private readonly consumerInstance: Consumer;
  private readonly logger = new Logger(KafkaClient.name);
  private disconnecting: Promise<void> | undefined;

  constructor(options: KafkaClientOptions) {
    this.consumerGroup = options.consumerGroup;
    const kafkaConfig: KafkaConfig = {
      brokers: options.brokers,
      clientId: options.clientId,
      logLevel: logLevel.NOTHING,
      retry: { retries: 8 },
    };
    this.kafka = new Kafka(kafkaConfig);
    this.consumerInstance = this.kafka.consumer({
      groupId: options.consumerGroup,
      rebalanceTimeout: 600_000,
    });
  }

  consumer(): Consumer {
    return this.consumerInstance;
  }

  async disconnect(): Promise<void> {
    this.disconnecting ??= this.consumerInstance
      .disconnect()
      .catch((error: unknown) => {
        this.logger.warn({
          error_type: error instanceof Error ? error.name : 'UnknownError',
          event: 'kafka_consumer_disconnect_failed',
        });
      });
    await this.disconnecting;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.disconnect();
  }
}
