import {
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import {
  connect,
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
} from 'amqplib';

type ManagedChannel = Channel | ConfirmChannel;

export class RabbitMQClient implements OnApplicationShutdown, OnModuleInit {
  private readonly channelAttempts = new Map<string, Promise<ManagedChannel>>();
  private readonly channels = new Map<string, ManagedChannel>();
  private connection: ChannelModel | undefined;
  private connectionAttempt: Promise<ChannelModel> | undefined;
  private readonly logger = new Logger(RabbitMQClient.name);

  constructor(
    private readonly url: string,
    private readonly connectTimeoutMs: number,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.getConnection();
  }

  async consumerChannel(purpose: string): Promise<Channel> {
    return this.channel(purpose, false);
  }

  async confirmChannel(purpose: string): Promise<ConfirmChannel> {
    return this.channel(purpose, true) as Promise<ConfirmChannel>;
  }

  isConnected(): boolean {
    return this.connection !== undefined;
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(
      [...this.channels.values()].map((channel) =>
        channel.close().catch(() => undefined),
      ),
    );
    await this.connection?.close().catch(() => undefined);
  }

  private async channel(
    purpose: string,
    confirm: boolean,
  ): Promise<ManagedChannel> {
    const existing = this.channels.get(purpose);
    if (existing !== undefined) {
      return existing;
    }

    const pending = this.channelAttempts.get(purpose);
    if (pending !== undefined) {
      return pending;
    }

    const attempt = this.createChannel(purpose, confirm).finally(() => {
      this.channelAttempts.delete(purpose);
    });
    this.channelAttempts.set(purpose, attempt);
    return attempt;
  }

  private async createChannel(
    purpose: string,
    confirm: boolean,
  ): Promise<ManagedChannel> {
    const connection = await this.getConnection();
    const channel = confirm
      ? await connection.createConfirmChannel()
      : await connection.createChannel();

    channel.on('close', () => {
      if (this.channels.get(purpose) === channel) {
        this.channels.delete(purpose);
      }
    });
    channel.on('error', (error: Error) => {
      this.logger.error({
        error_type: error.name,
        event: 'rabbitmq_channel_error',
        purpose,
      });
    });
    this.channels.set(purpose, channel);
    return channel;
  }

  private async getConnection(): Promise<ChannelModel> {
    if (this.connection !== undefined) {
      return this.connection;
    }

    this.connectionAttempt ??= this.connect();

    try {
      return await this.connectionAttempt;
    } finally {
      this.connectionAttempt = undefined;
    }
  }

  private async connect(): Promise<ChannelModel> {
    const connection = await connect(this.url, {
      timeout: this.connectTimeoutMs,
    });
    connection.on('close', () => {
      this.channels.clear();
      this.connection = undefined;
    });
    connection.on('error', (error: Error) => {
      this.logger.error({
        error_type: error.name,
        event: 'rabbitmq_connection_error',
      });
    });
    this.connection = connection;
    return connection;
  }
}
