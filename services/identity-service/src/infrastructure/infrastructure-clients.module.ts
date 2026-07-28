import { Module } from '@nestjs/common';

import { RUNTIME_CONFIG } from '../config/runtime.constants';
import type { RuntimeConfig } from '../config/runtime-config';
import { RabbitMQClient } from './clients/rabbitmq.client';
import { RedisClient } from './clients/redis.client';

@Module({
  providers: [
    {
      provide: RedisClient,
      useFactory: (config: RuntimeConfig) =>
        new RedisClient(
          config.redisUrl,
          config.redisConnectTimeoutMs,
          config.redisOperationTimeoutMs,
        ),
      inject: [RUNTIME_CONFIG],
    },
    {
      provide: RabbitMQClient,
      useFactory: (config: RuntimeConfig) =>
        new RabbitMQClient(config.rabbitMqUrl, config.rabbitMqConnectTimeoutMs),
      inject: [RUNTIME_CONFIG],
    },
  ],
  exports: [RabbitMQClient, RedisClient],
})
export class InfrastructureClientsModule {}
