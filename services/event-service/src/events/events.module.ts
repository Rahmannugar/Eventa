import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import type { RuntimeConfig } from '../config/runtime-config';
import { RUNTIME_CONFIG } from '../config/runtime.constants';
import { RabbitMQClient } from '../infrastructure/clients/rabbitmq.client';
import { R2Client } from '../infrastructure/clients/r2.client';
import { RabbitMQEventMediaVerificationJobPublisher } from './adapters/job-queue/rabbitmq-event-media-verification-job.publisher';
import {
  EVENT_MANAGEMENT,
  EVENT_MEDIA_MANAGEMENT,
  EVENT_MEDIA_OBJECT_STORAGE,
  EVENT_MEDIA_UPLOAD_REPOSITORY,
  EVENT_MEDIA_VERIFICATION_JOB_PUBLISHER,
} from './constants/event.constants';
import { EventController } from './controllers/event.controller';
import { EventMediaVerificationConsumer } from './jobs/event-media-verification.consumer';
import { EventMediaVerificationDispatcher } from './jobs/event-media-verification.dispatcher';
import { ObservedEventMediaManagement } from './observability/observed-event-media-management';
import { ObservedEventManagement } from './observability/observed-event-management';
import { EventMediaUploadRepository } from './repositories/event-media-upload.repository';
import { EventRepository } from './repositories/event.repository';
import { EventMediaApplicationService } from './services/event-media.service';
import { EventMediaVerificationService } from './services/event-media-verification.service';
import { EventApplicationService } from './services/event.service';
import type {
  EventMediaObjectStorage,
  EventMediaUploadRepository as EventMediaUploadRepositoryPort,
  EventMediaVerificationJobPublisher,
  EventRepository as EventRepositoryPort,
} from './types/event.types';

@Module({
  imports: [DatabaseModule],
  controllers: [EventController],
  providers: [
    EventRepository,
    EventMediaUploadRepository,
    {
      provide: EVENT_MEDIA_UPLOAD_REPOSITORY,
      useExisting: EventMediaUploadRepository,
    },
    {
      provide: RabbitMQClient,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        new RabbitMQClient(config.rabbitMqUrl, config.rabbitMqConnectTimeoutMs),
    },
    {
      provide: EVENT_MEDIA_OBJECT_STORAGE,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) => new R2Client(config),
    },
    {
      provide: EVENT_MEDIA_VERIFICATION_JOB_PUBLISHER,
      inject: [RabbitMQClient, RUNTIME_CONFIG],
      useFactory: (rabbitMQ: RabbitMQClient, config: RuntimeConfig) =>
        new RabbitMQEventMediaVerificationJobPublisher(rabbitMQ, config),
    },
    {
      provide: EVENT_MANAGEMENT,
      useFactory: (events: EventRepositoryPort) =>
        new ObservedEventManagement(new EventApplicationService(events)),
      inject: [EventRepository],
    },
    {
      provide: EVENT_MEDIA_MANAGEMENT,
      inject: [EVENT_MEDIA_UPLOAD_REPOSITORY, EVENT_MEDIA_OBJECT_STORAGE],
      useFactory: (
        uploads: EventMediaUploadRepositoryPort,
        objects: EventMediaObjectStorage,
      ) =>
        new ObservedEventMediaManagement(
          new EventMediaApplicationService(uploads, objects),
        ),
    },
    {
      provide: EventMediaVerificationService,
      inject: [EVENT_MEDIA_UPLOAD_REPOSITORY, EVENT_MEDIA_OBJECT_STORAGE],
      useFactory: (
        uploads: EventMediaUploadRepositoryPort,
        objects: EventMediaObjectStorage,
      ) => new EventMediaVerificationService(uploads, objects),
    },
    {
      provide: EventMediaVerificationDispatcher,
      inject: [
        EVENT_MEDIA_UPLOAD_REPOSITORY,
        EVENT_MEDIA_VERIFICATION_JOB_PUBLISHER,
      ],
      useFactory: (
        uploads: EventMediaUploadRepositoryPort,
        jobs: EventMediaVerificationJobPublisher,
      ) => new EventMediaVerificationDispatcher(uploads, jobs),
    },
    {
      provide: EventMediaVerificationConsumer,
      inject: [RabbitMQClient, EventMediaVerificationService],
      useFactory: (
        rabbitMQ: RabbitMQClient,
        verifier: EventMediaVerificationService,
      ) => new EventMediaVerificationConsumer(rabbitMQ, verifier),
    },
  ],
})
export class EventsModule {}
