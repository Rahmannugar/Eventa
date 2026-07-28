import { Module } from '@nestjs/common';

import type { RuntimeConfig } from '../config/runtime-config';
import { RUNTIME_CONFIG } from '../config/runtime.constants';
import { DatabaseModule } from '../database/database.module';
import { RabbitMQClient } from '../infrastructure/clients/rabbitmq.client';
import { ResendClient } from '../infrastructure/clients/resend.client';
import {
  AUTH_EMAIL_DELIVERY_REPOSITORY,
  EMAIL_DELIVERY_PROVIDER,
} from './constants/auth-email-delivery.constants';
import { AdminActivationJobConsumer } from './job-queue/admin-activation-job.consumer';
import { EmailVerificationJobConsumer } from './job-queue/email-verification-job.consumer';
import { PasswordResetJobConsumer } from './job-queue/password-reset-job.consumer';
import type { EmailDeliveryProvider } from './ports/email-delivery.provider';
import { AuthEmailDeliveryRepository } from './repositories/auth-email-delivery.repository';
import { AdminActivationDeliveryService } from './services/admin-activation-delivery.service';
import { EmailVerificationDeliveryService } from './services/email-verification-delivery.service';
import { PasswordResetDeliveryService } from './services/password-reset-delivery.service';

@Module({
  imports: [DatabaseModule],
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
      provide: PasswordResetJobConsumer,
      inject: [RabbitMQClient, PasswordResetDeliveryService, RUNTIME_CONFIG],
      useFactory: (
        rabbitMQ: RabbitMQClient,
        deliveryService: PasswordResetDeliveryService,
        config: RuntimeConfig,
      ) => new PasswordResetJobConsumer(rabbitMQ, deliveryService, config),
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
  ],
  exports: [RabbitMQClient],
})
export class NotificationsModule {}
