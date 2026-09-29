import { Module, type DynamicModule } from '@nestjs/common';
import {
  EVENTA_DISCOVERY_V1_PACKAGE_NAME,
  getDiscoveryProtoIncludeDirs,
  getDiscoveryProtoPaths,
} from '@eventa/grpc-contracts';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { RATE_LIMIT_STATE } from '../../rate-limit/constants/rate-limit.constants';
import type { RateLimitState } from '../../rate-limit/ports/rate-limit.state';
import {
  DISCOVERY_GRPC_CLIENT,
  DISCOVERY_GRPC_DEADLINE_MS,
} from './constants/discovery.constants';
import { DiscoveryInterestsController } from './controllers/discovery-interests.controller';
import { DiscoveryRecommendationsController } from './controllers/discovery-recommendations.controller';
import { DiscoverySearchController } from './controllers/discovery-search.controller';
import {
  InterestsRateLimitService,
  InterestsReadRateLimitGuard,
  InterestsWriteRateLimitGuard,
} from './rate-limit/discovery-interests-rate-limit';
import {
  RecommendationsRateLimitGuard,
  RecommendationsRateLimitService,
} from './rate-limit/discovery-recommendations-rate-limit';
import {
  EventSearchRateLimitGuard,
  EventSearchRateLimitService,
} from './rate-limit/discovery-search-rate-limit';
import { DiscoveryInterestsService } from './services/discovery-interests.service';
import { DiscoveryRecommendationsService } from './services/discovery-recommendations.service';
import { DiscoverySearchService } from './services/discovery-search.service';

interface DiscoveryModuleOptions {
  attendeesModule: DynamicModule;
  discoveryGrpcDeadlineMs: number;
  discoveryGrpcUrl: string;
  rateLimitKeySecret: string;
}

@Module({})
export class DiscoveryModule {
  static register(options: DiscoveryModuleOptions): DynamicModule {
    return {
      module: DiscoveryModule,
      imports: [
        options.attendeesModule,
        ClientsModule.register([
          {
            name: DISCOVERY_GRPC_CLIENT,
            transport: Transport.GRPC,
            options: {
              package: EVENTA_DISCOVERY_V1_PACKAGE_NAME,
              protoPath: getDiscoveryProtoPaths(),
              loader: {
                arrays: true,
                includeDirs: getDiscoveryProtoIncludeDirs(),
              },
              url: options.discoveryGrpcUrl,
            },
          },
        ]),
      ],
      controllers: [
        DiscoverySearchController,
        DiscoveryInterestsController,
        DiscoveryRecommendationsController,
      ],
      providers: [
        {
          provide: DISCOVERY_GRPC_DEADLINE_MS,
          useValue: options.discoveryGrpcDeadlineMs,
        },
        {
          provide: EventSearchRateLimitService,
          useFactory: (state: RateLimitState) =>
            new EventSearchRateLimitService(
              state,
              options.rateLimitKeySecret,
            ),
          inject: [RATE_LIMIT_STATE],
        },
        EventSearchRateLimitGuard,
        {
          provide: InterestsRateLimitService,
          useFactory: (state: RateLimitState) =>
            new InterestsRateLimitService(state, options.rateLimitKeySecret),
          inject: [RATE_LIMIT_STATE],
        },
        InterestsReadRateLimitGuard,
        InterestsWriteRateLimitGuard,
        {
          provide: RecommendationsRateLimitService,
          useFactory: (state: RateLimitState) =>
            new RecommendationsRateLimitService(state, options.rateLimitKeySecret),
          inject: [RATE_LIMIT_STATE],
        },
        RecommendationsRateLimitGuard,
        DiscoverySearchService,
        DiscoveryInterestsService,
        DiscoveryRecommendationsService,
      ],
    };
  }
}
