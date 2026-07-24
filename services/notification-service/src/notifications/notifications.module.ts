import { Module } from '@nestjs/common';

import type { RuntimeConfig } from '../config/runtime-config';
import { RUNTIME_CONFIG } from '../config/runtime.constants';
import { DatabaseModule } from '../database/database.module';
import { RabbitMQClient } from '../infrastructure/clients/rabbitmq.client';
import { ResendClient } from '../infrastructure/clients/resend.client';
import {
  EMAIL_DELIVERY_PROVIDER,
  EMAIL_VERIFICATION_DELIVERY_REPOSITORY,
  EMAIL_VERIFICATION_EMAIL_SENDER,
} from './constants/email-verification-delivery.constants';
import { EmailVerificationJobConsumer } from './job-queue/email-verification-job.consumer';
import type { EmailDeliveryProvider } from './ports/email-delivery.provider';
import { EmailVerificationDeliveryRepository } from './repositories/email-verification-delivery.repository';
import { EmailVerificationDeliveryService } from './services/email-verification-delivery.service';
import { EmailVerificationEmailSender } from './services/email-verification-email.sender';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: EMAIL_VERIFICATION_DELIVERY_REPOSITORY,
      useClass: EmailVerificationDeliveryRepository,
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
      provide: EMAIL_VERIFICATION_EMAIL_SENDER,
      inject: [EMAIL_DELIVERY_PROVIDER, RUNTIME_CONFIG],
      useFactory: (
        emailDeliveryProvider: EmailDeliveryProvider,
        config: RuntimeConfig,
      ) =>
        new EmailVerificationEmailSender(
          emailDeliveryProvider,
          config.resendFrom,
        ),
    },
    EmailVerificationDeliveryService,
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
