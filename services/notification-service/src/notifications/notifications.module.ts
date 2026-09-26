import { Module } from '@nestjs/common';
import {
  ClientsModule,
  Transport,
  type ClientGrpc,
} from '@nestjs/microservices';
import {
  EVENTA_EVENT_V1_PACKAGE_NAME,
  EVENTA_IDENTITY_V1_PACKAGE_NAME,
  getEventProtoIncludeDirs,
  getEventProtoPaths,
  getIdentityProtoIncludeDirs,
  getIdentityProtoPaths,
} from '@eventa/grpc-contracts';
import {
  ADMIN_PASSWORD_RESET_JOB_TYPE,
  ADMIN_PASSWORD_RESET_QUEUE,
} from '@eventa/messaging-contracts/identity/admin-auth.jobs';
import {
  ATTENDEE_PASSWORD_RESET_JOB_TYPE,
  ATTENDEE_PASSWORD_RESET_QUEUE,
} from '@eventa/messaging-contracts/identity/attendee-auth.jobs';

import type { RuntimeConfig } from '../config/runtime-config';
import { RUNTIME_CONFIG } from '../config/runtime.constants';
import { DatabaseModule } from '../database/database.module';
import { KafkaClient } from '../infrastructure/clients/kafka.client';
import { RabbitMQClient } from '../infrastructure/clients/rabbitmq.client';
import { ResendClient } from '../infrastructure/clients/resend.client';
import { EventGrpcSummaryAdapter } from './adapters/event-grpc-summary.adapter';
import { IdentityGrpcContactAdapter } from './adapters/identity-grpc-contact.adapter';
import {
  ADMIN_PASSWORD_RESET_CONSUMER,
  ATTENDEE_PASSWORD_RESET_CONSUMER,
  AUTH_EMAIL_DELIVERY_REPOSITORY,
  EMAIL_DELIVERY_PROVIDER,
} from './constants/auth-email-delivery.constants';
import {
  ATTENDEE_CONTACT_PROVIDER,
  CANCELLATION_EMAIL_DELIVERY_REPOSITORY,
  EVENT_CANCELLATION_EMAIL_CONSUMER,
  EVENT_GRPC_CLIENT,
  EVENT_SUMMARY_PROVIDER,
  IDENTITY_GRPC_CLIENT,
} from './constants/cancellation-email.constants';
import { AdminActivationJobConsumer } from './job-queue/auth/admin-activation-job.consumer';
import { EmailVerificationJobConsumer } from './job-queue/auth/email-verification-job.consumer';
import { PasswordResetJobConsumer } from './job-queue/auth/password-reset-job.consumer';
import { EventCancellationEmailJobConsumer } from './job-queue/cancellation/event-cancellation-email-job.consumer';
import { EventCancellationEmailQueueTopology } from './job-queue/cancellation/event-cancellation-email-queue.topology';
import { TicketRevocationConsumer } from './job-queue/cancellation/ticket-revocation.consumer';
import type { AttendeeContactProvider } from './ports/attendee-contact.provider';
import type { EmailDeliveryProvider } from './ports/email-delivery.provider';
import type { EventSummaryProvider } from './ports/event-summary.provider';
import { AuthEmailDeliveryRepository } from './repositories/auth-email-delivery.repository';
import { CancellationEmailRepository } from './repositories/cancellation-email.repository';
import { AdminActivationDeliveryService } from './services/admin-activation-delivery.service';
import { CancellationEmailDeliveryService } from './services/cancellation-email-delivery.service';
import { CancellationEmailIngestService } from './services/cancellation-email-ingest.service';
import { EmailVerificationDeliveryService } from './services/email-verification-delivery.service';
import { PasswordResetDeliveryService } from './services/password-reset-delivery.service';

@Module({
  imports: [
    DatabaseModule,
    ClientsModule.registerAsync([
      {
        name: IDENTITY_GRPC_CLIENT,
        inject: [RUNTIME_CONFIG],
        useFactory: (config: RuntimeConfig) => ({
          transport: Transport.GRPC,
          options: {
            package: EVENTA_IDENTITY_V1_PACKAGE_NAME,
            protoPath: getIdentityProtoPaths(),
            loader: {
              arrays: true,
              includeDirs: getIdentityProtoIncludeDirs(),
            },
            url: config.identityGrpcUrl,
          },
        }),
      },
      {
        name: EVENT_GRPC_CLIENT,
        inject: [RUNTIME_CONFIG],
        useFactory: (config: RuntimeConfig) => ({
          transport: Transport.GRPC,
          options: {
            package: EVENTA_EVENT_V1_PACKAGE_NAME,
            protoPath: getEventProtoPaths(),
            loader: { arrays: true, includeDirs: getEventProtoIncludeDirs() },
            url: config.eventGrpcUrl,
          },
        }),
      },
    ]),
  ],
  providers: [
    {
      provide: AUTH_EMAIL_DELIVERY_REPOSITORY,
      useClass: AuthEmailDeliveryRepository,
    },
    {
      provide: RabbitMQClient,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        new RabbitMQClient(config.rabbitMqUrl, config.rabbitMqConnectTimeoutMs),
    },
    {
      provide: EMAIL_DELIVERY_PROVIDER,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        new ResendClient(config.resendApiKey, config.resendRequestTimeoutMs),
    },
    {
      provide: EmailVerificationDeliveryService,
      inject: [
        AUTH_EMAIL_DELIVERY_REPOSITORY,
        EMAIL_DELIVERY_PROVIDER,
        RUNTIME_CONFIG,
      ],
      useFactory: (
        deliveries: AuthEmailDeliveryRepository,
        emailDeliveryProvider: EmailDeliveryProvider,
        config: RuntimeConfig,
      ) =>
        new EmailVerificationDeliveryService(
          deliveries,
          emailDeliveryProvider,
          config.resendFrom,
        ),
    },
    {
      provide: PasswordResetDeliveryService,
      inject: [
        AUTH_EMAIL_DELIVERY_REPOSITORY,
        EMAIL_DELIVERY_PROVIDER,
        RUNTIME_CONFIG,
      ],
      useFactory: (
        deliveries: AuthEmailDeliveryRepository,
        emailDeliveryProvider: EmailDeliveryProvider,
        config: RuntimeConfig,
      ) =>
        new PasswordResetDeliveryService(
          deliveries,
          emailDeliveryProvider,
          config.resendFrom,
        ),
    },
    {
      provide: AdminActivationDeliveryService,
      inject: [
        AUTH_EMAIL_DELIVERY_REPOSITORY,
        EMAIL_DELIVERY_PROVIDER,
        RUNTIME_CONFIG,
      ],
      useFactory: (
        deliveries: AuthEmailDeliveryRepository,
        emailDeliveryProvider: EmailDeliveryProvider,
        config: RuntimeConfig,
      ) =>
        new AdminActivationDeliveryService(
          deliveries,
          emailDeliveryProvider,
          config.resendFrom,
        ),
    },
    {
      provide: AdminActivationJobConsumer,
      inject: [RabbitMQClient, AdminActivationDeliveryService, RUNTIME_CONFIG],
      useFactory: (
        rabbitMQ: RabbitMQClient,
        deliveryService: AdminActivationDeliveryService,
        config: RuntimeConfig,
      ) => new AdminActivationJobConsumer(rabbitMQ, deliveryService, config),
    },
    {
      provide: ATTENDEE_PASSWORD_RESET_CONSUMER,
      inject: [RabbitMQClient, PasswordResetDeliveryService, RUNTIME_CONFIG],
      useFactory: (
        rabbitMQ: RabbitMQClient,
        deliveryService: PasswordResetDeliveryService,
        config: RuntimeConfig,
      ) =>
        new PasswordResetJobConsumer(rabbitMQ, deliveryService, config, {
          jobType: ATTENDEE_PASSWORD_RESET_JOB_TYPE,
          operation: 'attendee.password_reset.delivery',
          queue: ATTENDEE_PASSWORD_RESET_QUEUE,
        }),
    },
    {
      provide: ADMIN_PASSWORD_RESET_CONSUMER,
      inject: [RabbitMQClient, PasswordResetDeliveryService, RUNTIME_CONFIG],
      useFactory: (
        rabbitMQ: RabbitMQClient,
        deliveryService: PasswordResetDeliveryService,
        config: RuntimeConfig,
      ) =>
        new PasswordResetJobConsumer(rabbitMQ, deliveryService, config, {
          jobType: ADMIN_PASSWORD_RESET_JOB_TYPE,
          operation: 'admin.password_reset.delivery',
          queue: ADMIN_PASSWORD_RESET_QUEUE,
        }),
    },
    {
      provide: EmailVerificationJobConsumer,
      inject: [
        RabbitMQClient,
        EmailVerificationDeliveryService,
        RUNTIME_CONFIG,
      ],
      useFactory: (
        rabbitMQ: RabbitMQClient,
        deliveryService: EmailVerificationDeliveryService,
        config: RuntimeConfig,
      ) => new EmailVerificationJobConsumer(rabbitMQ, deliveryService, config),
    },
    {
      provide: KafkaClient,
      inject: [RUNTIME_CONFIG],
      useFactory: (config: RuntimeConfig) =>
        new KafkaClient({
          brokers: config.kafkaBrokers,
          clientId: 'eventa-notification-service',
          consumerGroup: config.kafkaConsumerGroup,
        }),
    },
    CancellationEmailRepository,
    {
      provide: CANCELLATION_EMAIL_DELIVERY_REPOSITORY,
      useExisting: CancellationEmailRepository,
    },
    {
      provide: ATTENDEE_CONTACT_PROVIDER,
      inject: [IDENTITY_GRPC_CLIENT, RUNTIME_CONFIG],
      useFactory: (client: ClientGrpc, config: RuntimeConfig) =>
        new IdentityGrpcContactAdapter(client, config.identityGrpcDeadlineMs),
    },
    {
      provide: EVENT_SUMMARY_PROVIDER,
      inject: [EVENT_GRPC_CLIENT, RUNTIME_CONFIG],
      useFactory: (client: ClientGrpc, config: RuntimeConfig) =>
        new EventGrpcSummaryAdapter(client, config.eventGrpcDeadlineMs),
    },
    {
      provide: CancellationEmailDeliveryService,
      inject: [
        CANCELLATION_EMAIL_DELIVERY_REPOSITORY,
        ATTENDEE_CONTACT_PROVIDER,
        EVENT_SUMMARY_PROVIDER,
        EMAIL_DELIVERY_PROVIDER,
        RUNTIME_CONFIG,
      ],
      useFactory: (
        deliveries: CancellationEmailRepository,
        attendeeContacts: AttendeeContactProvider,
        eventSummaries: EventSummaryProvider,
        emailDeliveryProvider: EmailDeliveryProvider,
        config: RuntimeConfig,
      ) =>
        new CancellationEmailDeliveryService(
          deliveries,
          attendeeContacts,
          eventSummaries,
          emailDeliveryProvider,
          config.resendFrom,
        ),
    },
    {
      provide: EVENT_CANCELLATION_EMAIL_CONSUMER,
      inject: [
        RabbitMQClient,
        CancellationEmailDeliveryService,
        RUNTIME_CONFIG,
      ],
      useFactory: (
        rabbitMQ: RabbitMQClient,
        deliveryService: CancellationEmailDeliveryService,
        config: RuntimeConfig,
      ) =>
        new EventCancellationEmailJobConsumer(
          rabbitMQ,
          deliveryService,
          config,
        ),
    },
    CancellationEmailIngestService,
    EventCancellationEmailQueueTopology,
    {
      provide: TicketRevocationConsumer,
      inject: [KafkaClient, CancellationEmailIngestService, RUNTIME_CONFIG],
      useFactory: (
        kafka: KafkaClient,
        ingest: CancellationEmailIngestService,
        config: RuntimeConfig,
      ) =>
        new TicketRevocationConsumer(
          kafka,
          ingest,
          config.kafkaTicketRevokedTopic,
        ),
    },
  ],
  exports: [RabbitMQClient],
})
export class NotificationsModule {}
