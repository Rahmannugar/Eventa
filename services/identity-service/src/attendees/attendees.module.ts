import { Module } from '@nestjs/common';
import { createClient } from 'redis';

import { RUNTIME_CONFIG } from '../config/runtime.constants';
import type { RuntimeConfig } from '../config/runtime-config';
import { DatabaseModule } from '../database/database.module';
import { SecurityModule } from '../security/security.module';
import {
  ATTENDEE_EMAIL_VERIFICATION_REPOSITORY,
  ATTENDEE_EMAIL_VERIFICATION_SERVICE,
  EMAIL_VERIFICATION_OTP_STORE,
  EMAIL_VERIFICATION_REDIS_CLIENT,
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
import { RedisEmailVerificationOtpStore } from './adapters/redis-email-verification-otp-store';
import type {
  AttendeeEmailVerificationRepository,
  EmailVerificationOtpStore,
  EmailVerificationRedisClient,
} from './types/attendee-email-verification.types';

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
      provide: EMAIL_VERIFICATION_REDIS_CLIENT,
      useFactory: (config: RuntimeConfig) =>
        createClient({
          disableOfflineQueue: true,
          socket: {
            connectTimeout: config.redisConnectTimeoutMs,
            reconnectStrategy: false,
          },
          url: config.redisUrl,
        }),
      inject: [RUNTIME_CONFIG],
    },
    {
      provide: EMAIL_VERIFICATION_OTP_STORE,
      useFactory: (
        client: EmailVerificationRedisClient,
        config: RuntimeConfig,
      ) =>
        new RedisEmailVerificationOtpStore(
          client,
          config.redisOperationTimeoutMs,
        ),
      inject: [EMAIL_VERIFICATION_REDIS_CLIENT, RUNTIME_CONFIG],
    },
    {
      provide: ATTENDEE_EMAIL_VERIFICATION_SERVICE,
      useFactory: (
        repository: AttendeeEmailVerificationRepository,
        otpStore: EmailVerificationOtpStore,
        config: RuntimeConfig,
      ) =>
        new AttendeeEmailVerificationService(
          repository,
          otpStore,
          config.emailVerificationHmacSecret,
        ),
      inject: [
        ATTENDEE_EMAIL_VERIFICATION_REPOSITORY,
        EMAIL_VERIFICATION_OTP_STORE,
        RUNTIME_CONFIG,
      ],
    },
  ],
  exports: [ATTENDEE_EMAIL_VERIFICATION_SERVICE],
})
export class AttendeesModule {}
