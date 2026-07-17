import {
  MiddlewareConsumer,
  Module,
  type DynamicModule,
  type NestModule,
} from '@nestjs/common';
import {
  HttpRequestTelemetryMiddleware,
  TelemetryLifecycleService,
} from '@eventa/observability';

import type { RuntimeConfig } from './config/runtime-config';
import { AttendeeRegistrationModule } from './domains/attendees/attendee-registration.module';
import { HealthModule } from './health/health.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';

@Module({})
export class AppModule implements NestModule {
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
      providers: [HttpRequestTelemetryMiddleware, TelemetryLifecycleService],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpRequestTelemetryMiddleware).forRoutes('*');
  }
}
