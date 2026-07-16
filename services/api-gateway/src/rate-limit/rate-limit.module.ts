import { Global, Module, type DynamicModule } from '@nestjs/common';
import { createClient } from 'redis';

import { RedisRateLimitAdapter } from './adapters/redis-rate-limit.adapter';
import {
  RATE_LIMIT_REDIS_CLIENT,
  RATE_LIMIT_STORE,
} from './constants/rate-limit.constants';

interface RateLimitModuleOptions {
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
                connectTimeout: 1_000,
                reconnectStrategy: false,
              },
              url: options.redisUrl,
            }),
        },
        {
          provide: RATE_LIMIT_STORE,
          useClass: RedisRateLimitAdapter,
        },
      ],
      exports: [RATE_LIMIT_STORE],
    };
  }
}
