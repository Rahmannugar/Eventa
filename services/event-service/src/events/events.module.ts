import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module';
import type { RuntimeConfig } from '../config/runtime-config';
import { RUNTIME_CONFIG } from '../config/runtime.constants';
import { RabbitMQClient } from '../infrastructure/clients/rabbitmq.client';
import { R2Client } from '../infrastructure/clients/r2.client';
import { RabbitMQEventMediaVerificationJobPublisher } from './adapters/job-queue/rabbitmq-event-media-verification-job.publisher';
import { RabbitMQEventMediaObjectDeletionJobPublisher } from './adapters/job-queue/rabbitmq-event-media-object-deletion-job.publisher';
import {
  EVENT_MANAGEMENT,
  EVENT_MEDIA_MANAGEMENT,
  EVENT_MEDIA_MUTATION_REPOSITORY,
  EVENT_MEDIA_OBJECT_DELETION_JOB_PUBLISHER,
  EVENT_MEDIA_OBJECT_DELETION_REPOSITORY,
  EVENT_MEDIA_OBJECT_STORAGE,
  EVENT_MEDIA_UPLOAD_REPOSITORY,
  EVENT_MEDIA_VERIFICATION_JOB_PUBLISHER,
} from './constants/event.constants';
import { EventController } from './controllers/event.controller';
import { EventMediaVerificationConsumer } from './jobs/event-media-verification.consumer';
import { EventMediaVerificationDispatcher } from './jobs/event-media-verification.dispatcher';
import { EventMediaObjectDeletionConsumer } from './jobs/event-media-object-deletion.consumer';
import { EventMediaObjectDeletionDispatcher } from './jobs/event-media-object-deletion.dispatcher';
import { ObservedEventMediaManagement } from './observability/observed-event-media-management';
import { ObservedEventManagement } from './observability/observed-event-management';
import { EventMediaUploadRepository } from './repositories/event-media-upload.repository';
import { EventMediaMutationRepository } from './repositories/event-media-mutation.repository';
import { EventMediaObjectDeletionRepository } from './repositories/event-media-object-deletion.repository';
import { EventRepository } from './repositories/event.repository';
import { EventMediaApplicationService } from './services/event-media.service';
import { EventMediaObjectDeletionService } from './services/event-media-object-deletion.service';
import { EventMediaVerificationService } from './services/event-media-verification.service';
import { EventApplicationService } from './services/event.service';
import type {
  EventMediaObjectStorage,
  EventMediaMutationRepository as EventMediaMutationRepositoryPort,
  EventMediaObjectDeletionJobPublisher,
  EventMediaObjectDeletionRepository as EventMediaObjectDeletionRepositoryPort,
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
    EventMediaMutationRepository,
    EventMediaObjectDeletionRepository,
    {
      provide: EVENT_MEDIA_MUTATION_REPOSITORY,
      useExisting: EventMediaMutationRepository,
    },
    {
      provide: EVENT_MEDIA_OBJECT_DELETION_REPOSITORY,
      useExisting: EventMediaObjectDeletionRepository,
    },
    {
      provide: EVENT_MEDIA_UPLOAD_REPOSITORY,
      useExisting: EventMediaUploadRepository,
    },
    {
      provide: EVENT_MEDIA_OBJECT_DELETION_JOB_PUBLISHER,
      inject: [RabbitMQClient, RUNTIME_CONFIG],
      useFactory: (rabbitMQ: RabbitMQClient, config: RuntimeConfig) =>
        new RabbitMQEventMediaObjectDeletionJobPublisher(rabbitMQ, config),
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
      inject: [
        EVENT_MEDIA_UPLOAD_REPOSITORY,
        EVENT_MEDIA_MUTATION_REPOSITORY,
        EVENT_MEDIA_OBJECT_STORAGE,
      ],
      useFactory: (
        uploads: EventMediaUploadRepositoryPort,
        media: EventMediaMutationRepositoryPort,
        objects: EventMediaObjectStorage,
      ) =>
        new ObservedEventMediaManagement(
          new EventMediaApplicationService(uploads, media, objects),
        ),
    },
    {
      provide: EventMediaObjectDeletionService,
      inject: [
        EVENT_MEDIA_OBJECT_DELETION_REPOSITORY,
        EVENT_MEDIA_OBJECT_STORAGE,
      ],
      useFactory: (
        deletions: EventMediaObjectDeletionRepositoryPort,
        objects: EventMediaObjectStorage,
      ) => new EventMediaObjectDeletionService(deletions, objects),
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
      provide: EventMediaObjectDeletionDispatcher,
      inject: [
        EVENT_MEDIA_OBJECT_DELETION_REPOSITORY,
        EVENT_MEDIA_OBJECT_DELETION_JOB_PUBLISHER,
      ],
      useFactory: (
        deletions: EventMediaObjectDeletionRepositoryPort,
        jobs: EventMediaObjectDeletionJobPublisher,
      ) => new EventMediaObjectDeletionDispatcher(deletions, jobs),
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
      provide: EventMediaObjectDeletionConsumer,
      inject: [RabbitMQClient, EventMediaObjectDeletionService],
      useFactory: (
        rabbitMQ: RabbitMQClient,
        deletions: EventMediaObjectDeletionService,
      ) => new EventMediaObjectDeletionConsumer(rabbitMQ, deletions),
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
