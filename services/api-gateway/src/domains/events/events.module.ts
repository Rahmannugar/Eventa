import { Module, type DynamicModule } from '@nestjs/common';
import {
  EVENTA_EVENT_V1_PACKAGE_NAME,
  getEventProtoIncludeDirs,
  getEventProtoPaths,
} from '@eventa/grpc-contracts';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { RATE_LIMIT_STATE } from '../../rate-limit/constants/rate-limit.constants';
import type { RateLimitState } from '../../rate-limit/ports/rate-limit.state';
import {
  EVENT_GRPC_CLIENT,
  EVENT_GRPC_DEADLINE_MS,
} from './constants/event.constants';
import { AdminEventController } from './controllers/admin-event.controller';
import { PublishedEventController } from './controllers/published-event.controller';
import {
  AdminEventCreateRateLimitGuard,
  AdminEventMediaUploadRateLimitGuard,
  AdminEventPublishRateLimitGuard,
  AdminEventRateLimitService,
  AdminEventReadRateLimitGuard,
  AdminEventUpdateRateLimitGuard,
} from './rate-limit/admin-event-rate-limit';
import {
  PublishedEventRateLimitService,
  PublishedEventReadRateLimitGuard,
} from './rate-limit/published-event-rate-limit';
import { AdminEventService } from './services/admin-event.service';
import { PublishedEventService } from './services/published-event.service';

interface EventsModuleOptions {
  adminsModule: DynamicModule;
  eventGrpcDeadlineMs: number;
  eventGrpcUrl: string;
  rateLimitKeySecret: string;
}

@Module({})
export class EventsModule {
  static register(options: EventsModuleOptions): DynamicModule {
    return {
      module: EventsModule,
      imports: [
        options.adminsModule,
        ClientsModule.register([
          {
            name: EVENT_GRPC_CLIENT,
            transport: Transport.GRPC,
            options: {
              package: EVENTA_EVENT_V1_PACKAGE_NAME,
              protoPath: getEventProtoPaths(),
              loader: { includeDirs: getEventProtoIncludeDirs() },
              url: options.eventGrpcUrl,
            },
          },
        ]),
      ],
      controllers: [AdminEventController, PublishedEventController],
      providers: [
        {
          provide: EVENT_GRPC_DEADLINE_MS,
          useValue: options.eventGrpcDeadlineMs,
        },
        {
          provide: AdminEventRateLimitService,
          useFactory: (state: RateLimitState) =>
            new AdminEventRateLimitService(state, options.rateLimitKeySecret),
          inject: [RATE_LIMIT_STATE],
        },
        AdminEventService,
        PublishedEventService,
        AdminEventCreateRateLimitGuard,
        AdminEventReadRateLimitGuard,
        AdminEventMediaUploadRateLimitGuard,
        AdminEventPublishRateLimitGuard,
        AdminEventUpdateRateLimitGuard,
        {
          provide: PublishedEventRateLimitService,
          useFactory: (state: RateLimitState) =>
            new PublishedEventRateLimitService(
              state,
              options.rateLimitKeySecret,
            ),
          inject: [RATE_LIMIT_STATE],
        },
        PublishedEventReadRateLimitGuard,
      ],
    };
  }
}
