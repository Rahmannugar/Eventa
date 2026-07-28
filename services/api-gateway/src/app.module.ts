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
import { AttendeesModule } from './domains/attendees/attendees.module';
import { HealthModule } from './health/health.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { AdminsModule } from './domains/admins/admins.module';

@Module({})
export class AppModule implements NestModule {
  static register(config: RuntimeConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        HealthModule,
        RateLimitModule.register({
          connectTimeoutMs: config.redisConnectTimeoutMs,
          operationTimeoutMs: config.redisOperationTimeoutMs,
          redisUrl: config.redisUrl,
        }),
        AdminsModule.register({
          adminClientOrigin: config.adminClientOrigin,
          identityGrpcDeadlineMs: config.identityGrpcDeadlineMs,
          identityGrpcUrl: config.identityGrpcUrl,
          rateLimitKeySecret: config.rateLimitKeySecret,
          secureCookies: config.publicApiUrl.startsWith('https://'),
        }),
        AttendeesModule.register({
          attendeeClientOrigin: config.attendeeClientOrigin,
          identityGrpcDeadlineMs: config.identityGrpcDeadlineMs,
          identityGrpcUrl: config.identityGrpcUrl,
          rateLimitKeySecret: config.rateLimitKeySecret,
          secureSessionCookie: config.publicApiUrl.startsWith('https://'),
        }),
      ],
      providers: [HttpRequestTelemetryMiddleware, TelemetryLifecycleService],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpRequestTelemetryMiddleware).forRoutes('*');
  }
}
