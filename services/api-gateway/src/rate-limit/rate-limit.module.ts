import { Global, Module, type DynamicModule } from '@nestjs/common';
import { createClient } from 'redis';

import { RedisRateLimitAdapter } from './adapters/redis-rate-limit.adapter';
import {
  RATE_LIMIT_REDIS_CLIENT,
  RATE_LIMIT_STORE,
} from './constants/rate-limit.constants';
import type { RateLimitRedisClient } from './types/rate-limit.types';

interface RateLimitModuleOptions {
  connectTimeoutMs: number;
  operationTimeoutMs: number;
  redisUrl: string;
}

@Global()
@Module({})
export class RateLimitModule {
  static register(options: RateLimitModuleOptions): DynamicModule {
    return {
      module: RateLimitModule,
      providers: [
        {
          provide: RATE_LIMIT_REDIS_CLIENT,
          useFactory: () =>
            createClient({
              disableOfflineQueue: true,
              socket: {
                connectTimeout: options.connectTimeoutMs,
                reconnectStrategy: false,
              },
              url: options.redisUrl,
            }),
        },
        {
          provide: RATE_LIMIT_STORE,
          useFactory: (client: RateLimitRedisClient) =>
            new RedisRateLimitAdapter(client, options.operationTimeoutMs),
          inject: [RATE_LIMIT_REDIS_CLIENT],
        },
      ],
      exports: [RATE_LIMIT_STORE],
    };
  }
}
