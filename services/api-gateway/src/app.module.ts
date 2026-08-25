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
import { EventsModule } from './domains/events/events.module';
import { CommerceModule } from './domains/commerce/commerce.module';

@Module({})
export class AppModule implements NestModule {
  static register(config: RuntimeConfig): DynamicModule {
    const adminsModule = AdminsModule.register({
      clientOrigin: config.clientOrigin,
      identityGrpcDeadlineMs: config.identityGrpcDeadlineMs,
      identityGrpcUrl: config.identityGrpcUrl,
      rateLimitKeySecret: config.rateLimitKeySecret,
      secureCookies: config.publicApiUrl.startsWith('https://'),
    });
    const attendeesModule = AttendeesModule.register({
      clientOrigin: config.clientOrigin,
      identityGrpcDeadlineMs: config.identityGrpcDeadlineMs,
      identityGrpcUrl: config.identityGrpcUrl,
      rateLimitKeySecret: config.rateLimitKeySecret,
      secureSessionCookie: config.publicApiUrl.startsWith('https://'),
    });

    return {
      module: AppModule,
      imports: [
        HealthModule,
        RateLimitModule.register({
          connectTimeoutMs: config.redisConnectTimeoutMs,
          operationTimeoutMs: config.redisOperationTimeoutMs,
          redisUrl: config.redisUrl,
        }),
        adminsModule,
        CommerceModule.register({
          attendeesModule,
          commerceGrpcDeadlineMs: config.commerceGrpcDeadlineMs,
          commerceGrpcUrl: config.commerceGrpcUrl,
          rateLimitKeySecret: config.rateLimitKeySecret,
        }),
        EventsModule.register({
          adminsModule,
          attendeesModule,
          eventGrpcDeadlineMs: config.eventGrpcDeadlineMs,
          eventGrpcUrl: config.eventGrpcUrl,
          rateLimitKeySecret: config.rateLimitKeySecret,
        }),
        attendeesModule,
      ],
      providers: [HttpRequestTelemetryMiddleware, TelemetryLifecycleService],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpRequestTelemetryMiddleware).forRoutes('*');
  }
}
