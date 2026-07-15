import { Module, type DynamicModule } from '@nestjs/common';

import { AttendeeRegistrationModule } from './attendees/attendee-registration.module';
import type { RuntimeConfig } from './config/runtime-config';
import { HealthModule } from './health/health.module';

@Module({})
export class AppModule {
  static register(config: RuntimeConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        HealthModule,
        AttendeeRegistrationModule.register({
          identityGrpcUrl: config.identityGrpcUrl,
          rateLimitKeySecret: config.rateLimitKeySecret,
          redisUrl: config.redisUrl,
        }),
      ],
    };
  }
}
