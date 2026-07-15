import { Module, type DynamicModule } from '@nestjs/common';
import { createClient } from 'redis';

import { RedisRateLimitAdapter } from './adapters/redis-rate-limit.adapter';
import {
  RATE_LIMIT_REDIS_CLIENT,
  RATE_LIMIT_STORE,
} from './constants/rate-limit.constants';
import { AttendeeRegistrationRateLimitGuard } from './guards/attendee-registration-rate-limit.guard';
import { AttendeeRegistrationRateLimitService } from './services/attendee-registration-rate-limit.service';

interface RateLimitModuleOptions {
  keySecret: string;
  redisUrl: string;
}

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
        {
          provide: AttendeeRegistrationRateLimitService,
          useFactory: (store: RedisRateLimitAdapter) =>
            new AttendeeRegistrationRateLimitService(store, options.keySecret),
          inject: [RATE_LIMIT_STORE],
        },
        AttendeeRegistrationRateLimitGuard,
      ],
      exports: [
        AttendeeRegistrationRateLimitGuard,
        AttendeeRegistrationRateLimitService,
      ],
    };
  }
}
