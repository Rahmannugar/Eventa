import { Module, type DynamicModule } from '@nestjs/common';
import {
  EVENTA_ANALYTICS_V1_PACKAGE_NAME,
  getAnalyticsProtoIncludeDirs,
  getAnalyticsProtoPaths,
} from '@eventa/grpc-contracts';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { RATE_LIMIT_STATE } from '../../rate-limit/constants/rate-limit.constants';
import type { RateLimitState } from '../../rate-limit/ports/rate-limit.state';
import {
  ANALYTICS_GRPC_CLIENT,
  ANALYTICS_GRPC_DEADLINE_MS,
} from './constants/analytics.constants';
import { AdminAnalyticsController } from './controllers/admin-analytics.controller';
import {
  AdminAnalyticsRateLimitService,
  AdminAnalyticsReadRateLimitGuard,
} from './rate-limit/admin-analytics-rate-limit';
import { AdminAnalyticsService } from './services/admin-analytics.service';

interface AnalyticsModuleOptions {
  adminsModule: DynamicModule;
  analyticsGrpcDeadlineMs: number;
  analyticsGrpcUrl: string;
  rateLimitKeySecret: string;
}

@Module({})
export class AnalyticsModule {
  static register(options: AnalyticsModuleOptions): DynamicModule {
    return {
      module: AnalyticsModule,
      imports: [
        options.adminsModule,
        ClientsModule.register([
          {
            name: ANALYTICS_GRPC_CLIENT,
            transport: Transport.GRPC,
            options: {
              package: EVENTA_ANALYTICS_V1_PACKAGE_NAME,
              protoPath: getAnalyticsProtoPaths(),
              loader: {
                arrays: true,
                includeDirs: getAnalyticsProtoIncludeDirs(),
              },
              url: options.analyticsGrpcUrl,
            },
          },
        ]),
      ],
      controllers: [AdminAnalyticsController],
      providers: [
        {
          provide: ANALYTICS_GRPC_DEADLINE_MS,
          useValue: options.analyticsGrpcDeadlineMs,
        },
        {
          provide: AdminAnalyticsRateLimitService,
          useFactory: (state: RateLimitState) =>
            new AdminAnalyticsRateLimitService(
              state,
              options.rateLimitKeySecret,
            ),
          inject: [RATE_LIMIT_STATE],
        },
        AdminAnalyticsReadRateLimitGuard,
        AdminAnalyticsService,
      ],
    };
  }
}
