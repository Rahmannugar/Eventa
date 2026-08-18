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
import { EventWaitlistController } from './controllers/event-waitlist.controller';
import {
  AdminEventCreateRateLimitGuard,
  AdminEventMediaStatusRateLimitGuard,
  AdminEventMediaUploadRateLimitGuard,
  AdminEventPublishRateLimitGuard,
  AdminEventRetireRateLimitGuard,
  AdminEventRateLimitService,
  AdminEventReadRateLimitGuard,
  AdminEventUpdateRateLimitGuard,
  AdminEventTicketTypeRateLimitGuard,
} from './rate-limit/admin-event-rate-limit';
import {
  PublishedEventRateLimitService,
  PublishedEventReadRateLimitGuard,
} from './rate-limit/published-event-rate-limit';
import { AdminEventService } from './services/admin-event.service';
import { PublishedEventService } from './services/published-event.service';
import { EventWaitlistService } from './services/event-waitlist.service';
import {
  EventWaitlistRateLimitGuard,
  EventWaitlistRateLimitService,
} from './rate-limit/event-waitlist-rate-limit';

interface EventsModuleOptions {
  adminsModule: DynamicModule;
  attendeesModule: DynamicModule;
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
        options.attendeesModule,
        ClientsModule.register([
          {
            name: EVENT_GRPC_CLIENT,
            transport: Transport.GRPC,
            options: {
              package: EVENTA_EVENT_V1_PACKAGE_NAME,
              protoPath: getEventProtoPaths(),
              loader: {
                arrays: true,
                includeDirs: getEventProtoIncludeDirs(),
              },
              url: options.eventGrpcUrl,
            },
          },
        ]),
      ],
      controllers: [
        AdminEventController,
        PublishedEventController,
        EventWaitlistController,
      ],
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
        EventWaitlistService,
        AdminEventCreateRateLimitGuard,
        AdminEventReadRateLimitGuard,
        AdminEventMediaStatusRateLimitGuard,
        AdminEventMediaUploadRateLimitGuard,
        AdminEventPublishRateLimitGuard,
        AdminEventRetireRateLimitGuard,
        AdminEventUpdateRateLimitGuard,
        AdminEventTicketTypeRateLimitGuard,
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
        {
          provide: EventWaitlistRateLimitService,
          useFactory: (state: RateLimitState) =>
            new EventWaitlistRateLimitService(
              state,
              options.rateLimitKeySecret,
            ),
          inject: [RATE_LIMIT_STATE],
        },
        EventWaitlistRateLimitGuard,
      ],
    };
  }
}
