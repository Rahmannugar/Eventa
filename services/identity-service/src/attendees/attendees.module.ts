import { Module } from '@nestjs/common';

import { RUNTIME_CONFIG } from '../config/runtime.constants';
import type { RuntimeConfig } from '../config/runtime-config';
import { DatabaseModule } from '../database/database.module';
import { RabbitMQClient } from '../infrastructure/clients/rabbitmq.client';
import { RedisClient } from '../infrastructure/clients/redis.client';
import { SecurityModule } from '../security/security.module';
import {
  ATTENDEE_EMAIL_VERIFICATION_REPOSITORY,
  ATTENDEE_EMAIL_VERIFICATION_SERVICE,
  ATTENDEE_REGISTRATION_EMAIL_VERIFICATION,
  EMAIL_VERIFICATION_JOB_PUBLISHER,
  EMAIL_VERIFICATION_OTP_STATE,
} from './constants/attendee-email-verification.constants';
import {
  ATTENDEE_ACCOUNT_REPOSITORY,
  ATTENDEE_REGISTRAR,
} from './constants/attendee-registration.constants';
import { AttendeeEmailVerificationService } from './services/attendee-email-verification.service';
import { AttendeeRegistrationService } from './services/attendee-registration.service';
import { AttendeeRegistrationController } from './controllers/attendee-registration.controller';
import { ObservedAttendeeRegistrar } from './observability/observed-attendee-registrar';
import { PostgresAttendeeAccountRepository } from './repositories/attendee-account.repository';
import { RabbitMQEmailVerificationJobPublisher } from './adapters/job-queue/email-verification-job.publisher';
import { RedisEmailVerificationOtpState } from './adapters/redis/email-verification-otp.state';
import { AttendeeRegistrationEmailVerificationService } from './services/attendee-registration-email-verification.service';
import type { AttendeeEmailVerificationRepository } from './types/attendee-email-verification.types';
import type { EmailVerificationOtpState } from './ports/email-verification-otp.state';

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [AttendeeRegistrationController],
  providers: [
    AttendeeRegistrationService,
    {
      provide: ATTENDEE_REGISTRAR,
      useFactory: (registration: AttendeeRegistrationService) =>
        new ObservedAttendeeRegistrar(registration),
      inject: [AttendeeRegistrationService],
    },
    {
      provide: ATTENDEE_ACCOUNT_REPOSITORY,
      useClass: PostgresAttendeeAccountRepository,
    },
    {
      provide: ATTENDEE_EMAIL_VERIFICATION_REPOSITORY,
      useExisting: ATTENDEE_ACCOUNT_REPOSITORY,
    },
    {
      provide: RedisClient,
      useFactory: (config: RuntimeConfig) =>
        new RedisClient(
          config.redisUrl,
          config.redisConnectTimeoutMs,
          config.redisOperationTimeoutMs,
        ),
      inject: [RUNTIME_CONFIG],
    },
    {
      provide: EMAIL_VERIFICATION_OTP_STATE,
      useFactory: (redis: RedisClient) =>
        new RedisEmailVerificationOtpState(redis),
      inject: [RedisClient],
    },
    {
      provide: ATTENDEE_EMAIL_VERIFICATION_SERVICE,
      useFactory: (
        repository: AttendeeEmailVerificationRepository,
        otpState: EmailVerificationOtpState,
        config: RuntimeConfig,
      ) =>
        new AttendeeEmailVerificationService(
          repository,
          otpState,
          config.emailVerificationHmacSecret,
        ),
      inject: [
        ATTENDEE_EMAIL_VERIFICATION_REPOSITORY,
        EMAIL_VERIFICATION_OTP_STATE,
        RUNTIME_CONFIG,
      ],
    },
    {
      provide: RabbitMQClient,
      useFactory: (config: RuntimeConfig) =>
        new RabbitMQClient(config.rabbitMqUrl, config.rabbitMqConnectTimeoutMs),
      inject: [RUNTIME_CONFIG],
    },
    {
      provide: EMAIL_VERIFICATION_JOB_PUBLISHER,
      useFactory: (rabbitMQ: RabbitMQClient, config: RuntimeConfig) =>
        new RabbitMQEmailVerificationJobPublisher(
          rabbitMQ,
          config.rabbitMqPublishTimeoutMs,
        ),
      inject: [RabbitMQClient, RUNTIME_CONFIG],
    },
    {
      provide: ATTENDEE_REGISTRATION_EMAIL_VERIFICATION,
      useClass: AttendeeRegistrationEmailVerificationService,
    },
  ],
  exports: [ATTENDEE_EMAIL_VERIFICATION_SERVICE],
})
export class AttendeesModule {}
