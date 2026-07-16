import { Module, type DynamicModule } from '@nestjs/common';

import type { RuntimeConfig } from './config/runtime-config';
import { AttendeeRegistrationModule } from './domains/attendees/attendee-registration.module';
import { HealthModule } from './health/health.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';

@Module({})
export class AppModule {
  static register(config: RuntimeConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        HealthModule,
        RateLimitModule.register({ redisUrl: config.redisUrl }),
        AttendeeRegistrationModule.register({
          identityGrpcUrl: config.identityGrpcUrl,
          rateLimitKeySecret: config.rateLimitKeySecret,
        }),
      ],
    };
  }
}
