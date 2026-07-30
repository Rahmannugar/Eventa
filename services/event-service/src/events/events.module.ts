import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import { EVENT_MANAGEMENT } from './constants/event.constants';
import { EventController } from './controllers/event.controller';
import { ObservedEventManagement } from './observability/observed-event-management';
import { EventRepository } from './repositories/event.repository';
import { EventApplicationService } from './services/event.service';
import type { EventRepository as EventRepositoryPort } from './types/event.types';

@Module({
  imports: [DatabaseModule],
  controllers: [EventController],
  providers: [
    EventRepository,
    {
      provide: EVENT_MANAGEMENT,
      useFactory: (events: EventRepositoryPort) =>
        new ObservedEventManagement(new EventApplicationService(events)),
      inject: [EventRepository],
    },
  ],
})
export class EventsModule {}
