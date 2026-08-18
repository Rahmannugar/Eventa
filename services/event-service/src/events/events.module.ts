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
  EVENT_CAPACITY_RESERVATION_MANAGEMENT,
  EVENT_CAPACITY_RESERVATION_REPOSITORY,
  EVENT_MEDIA_MANAGEMENT,
  EVENT_MEDIA_MUTATION_REPOSITORY,
  EVENT_MEDIA_OBJECT_DELETION_JOB_PUBLISHER,
  EVENT_MEDIA_OBJECT_DELETION_REPOSITORY,
  EVENT_MEDIA_OBJECT_STORAGE,
  EVENT_MEDIA_UPLOAD_REPOSITORY,
  EVENT_MEDIA_VERIFICATION_JOB_PUBLISHER,
  EVENT_TICKET_TYPE_MANAGEMENT,
  EVENT_TICKET_TYPE_REPOSITORY,
  EVENT_TICKET_AVAILABILITY_MANAGEMENT,
  EVENT_TICKET_AVAILABILITY_REPOSITORY,
  EVENT_WAITLIST_MANAGEMENT,
  EVENT_WAITLIST_REPOSITORY,
} from './constants/event.constants';
import { EventController } from './controllers/event.controller';
import { EventMediaVerificationConsumer } from './jobs/event-media-verification.consumer';
import { EventCapacityReservationExpiry } from './jobs/event-capacity-reservation-expiry';
import { EventWaitlistPromotion } from './jobs/event-waitlist-promotion';
import { EventMediaVerificationDispatcher } from './jobs/event-media-verification.dispatcher';
import { EventMediaObjectDeletionConsumer } from './jobs/event-media-object-deletion.consumer';
import { EventMediaObjectDeletionDispatcher } from './jobs/event-media-object-deletion.dispatcher';
import { ObservedEventMediaManagement } from './observability/observed-event-media-management';
import { ObservedEventManagement } from './observability/observed-event-management';
import { ObservedEventCapacityReservationManagement } from './observability/observed-event-capacity-reservation-management';
import { ObservedEventWaitlistManagement } from './observability/observed-event-waitlist-management';
import { EventMediaUploadRepository } from './repositories/event-media-upload.repository';
import { EventMediaMutationRepository } from './repositories/event-media-mutation.repository';
import { EventMediaObjectDeletionRepository } from './repositories/event-media-object-deletion.repository';
import { EventManagementRepository } from './repositories/event-management.repository';
import { EventCapacityReservationRepository } from './repositories/event-capacity-reservation.repository';
import { EventTicketTypeRepository } from './repositories/event-ticket-type.repository';
import { EventTicketAvailabilityRepository } from './repositories/event-ticket-availability.repository';
import { EventWaitlistRepository } from './repositories/event-waitlist.repository';
import { EventMediaApplicationService } from './services/event-media.service';
import { EventMediaObjectDeletionService } from './services/event-media-object-deletion.service';
import { EventMediaVerificationService } from './services/event-media-verification.service';
import { EventManagementService } from './services/event-management.service';
import { EventCapacityReservationService } from './services/event-capacity-reservation.service';
import { EventTicketTypeService } from './services/event-ticket-type.service';
import { EventTicketAvailabilityService } from './services/event-ticket-availability.service';
import { EventWaitlistService } from './services/event-waitlist.service';
import type {
  EventMediaObjectStorage,
  EventMediaMutationRepository as EventMediaMutationRepositoryPort,
  EventMediaObjectDeletionJobPublisher,
  EventMediaObjectDeletionRepository as EventMediaObjectDeletionRepositoryPort,
  EventMediaUploadRepository as EventMediaUploadRepositoryPort,
  EventMediaVerificationJobPublisher,
  EventCapacityReservationRepository as EventCapacityReservationRepositoryPort,
  EventRepository as EventRepositoryPort,
  EventTicketTypeRepository as EventTicketTypeRepositoryPort,
  EventTicketAvailabilityRepository as EventTicketAvailabilityRepositoryPort,
  EventWaitlistRepository as EventWaitlistRepositoryPort,
} from './types/event.types';

@Module({
  imports: [DatabaseModule],
  controllers: [EventController],
  providers: [
    EventManagementRepository,
    EventCapacityReservationRepository,
    EventTicketTypeRepository,
    EventTicketAvailabilityRepository,
    EventWaitlistRepository,
    EventMediaUploadRepository,
    EventMediaMutationRepository,
    EventMediaObjectDeletionRepository,
    {
      provide: EVENT_WAITLIST_REPOSITORY,
      useExisting: EventWaitlistRepository,
    },
    {
      provide: EVENT_WAITLIST_MANAGEMENT,
      inject: [EVENT_WAITLIST_REPOSITORY],
      useFactory: (waitlist: EventWaitlistRepositoryPort) =>
        new ObservedEventWaitlistManagement(new EventWaitlistService(waitlist)),
    },
    {
      provide: EventWaitlistPromotion,
      inject: [EVENT_WAITLIST_REPOSITORY],
      useFactory: (waitlist: EventWaitlistRepositoryPort) =>
        new EventWaitlistPromotion(waitlist),
    },
    {
      provide: EVENT_CAPACITY_RESERVATION_REPOSITORY,
      useExisting: EventCapacityReservationRepository,
    },
    {
      provide: EVENT_CAPACITY_RESERVATION_MANAGEMENT,
      inject: [EVENT_CAPACITY_RESERVATION_REPOSITORY],
      useFactory: (reservations: EventCapacityReservationRepositoryPort) =>
        new ObservedEventCapacityReservationManagement(
          new EventCapacityReservationService(reservations),
        ),
    },
    {
      provide: EventCapacityReservationExpiry,
      inject: [EVENT_CAPACITY_RESERVATION_REPOSITORY],
      useFactory: (reservations: EventCapacityReservationRepositoryPort) =>
        new EventCapacityReservationExpiry(reservations),
    },
    {
      provide: EVENT_TICKET_AVAILABILITY_REPOSITORY,
      useExisting: EventTicketAvailabilityRepository,
    },
    {
      provide: EVENT_TICKET_AVAILABILITY_MANAGEMENT,
      inject: [EVENT_TICKET_AVAILABILITY_REPOSITORY],
      useFactory: (availability: EventTicketAvailabilityRepositoryPort) =>
        new EventTicketAvailabilityService(availability),
    },
    {
      provide: EVENT_TICKET_TYPE_REPOSITORY,
      useExisting: EventTicketTypeRepository,
    },
    {
      provide: EVENT_TICKET_TYPE_MANAGEMENT,
      inject: [EVENT_TICKET_TYPE_REPOSITORY],
      useFactory: (ticketTypes: EventTicketTypeRepositoryPort) =>
        new EventTicketTypeService(ticketTypes),
    },
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
        new ObservedEventManagement(new EventManagementService(events)),
      inject: [EventManagementRepository],
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
