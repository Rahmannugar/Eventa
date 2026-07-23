import { Global, Module, type DynamicModule } from '@nestjs/common';

import { RedisClient } from '../infrastructure/clients/redis.client';
import { RedisRateLimitState } from './adapters/redis/rate-limit.state';
import { RATE_LIMIT_STATE } from './constants/rate-limit.constants';

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
          provide: RedisClient,
          useFactory: () =>
            new RedisClient(
              options.redisUrl,
              options.connectTimeoutMs,
              options.operationTimeoutMs,
            ),
        },
        {
          provide: RATE_LIMIT_STATE,
          useFactory: (redis: RedisClient) => new RedisRateLimitState(redis),
          inject: [RedisClient],
        },
      ],
      exports: [RATE_LIMIT_STATE],
    };
  }
}
