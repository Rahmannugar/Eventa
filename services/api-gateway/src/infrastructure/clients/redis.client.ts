import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import { createClient } from 'redis';

export class RedisClient implements OnApplicationShutdown {
  private readonly client;
  private connectionAttempt: Promise<void> | undefined;
  private readonly logger = new Logger(RedisClient.name);

  constructor(
    url: string,
    connectTimeoutMs: number,
    private readonly operationTimeoutMs: number,
  ) {
    this.client = createClient({
      disableOfflineQueue: true,
      socket: {
        connectTimeout: connectTimeoutMs,
        reconnectStrategy: false,
      },
      url,
    });
    this.client.on('error', (error: Error) => {
      this.logger.error({
        error_type: error.name,
        event: 'redis_connection_error',
      });
    });
  }

  async evaluate(
    script: string,
    keys: string[],
    arguments_: string[],
  ): Promise<unknown> {
    await this.ensureConnected();

    return this.client
      .withAbortSignal(AbortSignal.timeout(this.operationTimeoutMs))
      .eval(script, { arguments: arguments_, keys });
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.close();
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.isReady) {
      return;
    }

    if (!this.client.isOpen) {
      this.connectionAttempt ??= this.client
        .connect()
        .then(() => undefined)
        .finally(() => {
          this.connectionAttempt = undefined;
        });
    }

    if (this.connectionAttempt !== undefined) {
      await this.connectionAttempt;
    }

    if (!this.client.isReady) {
      throw new Error('REDIS_UNAVAILABLE');
    }
  }
}
