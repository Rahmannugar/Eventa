import { Module } from '@nestjs/common';

import { RUNTIME_CONFIG } from '../config/runtime.constants';
import type { RuntimeConfig } from '../config/runtime-config';
import { DatabaseModule } from '../database/database.module';
import { RabbitMQClient } from '../infrastructure/clients/rabbitmq.client';
import { RedisClient } from '../infrastructure/clients/redis.client';
import { SecurityModule } from '../security/security.module';
import {
  ATTENDEE_EMAIL_VERIFICATION_REPOSITORY,
  EMAIL_VERIFICATION_OTP_STATE,
} from './constants/attendee-email-verification.constants';
import { ATTENDEE_AUTH_JOB_PUBLISHER } from './constants/attendee-auth-job.constants';
import {
  ATTENDEE_ACCOUNT_REPOSITORY,
  ATTENDEE_REGISTRAR,
} from './constants/attendee-registration.constants';
import { ATTENDEE_SESSION_STATE } from './constants/attendee-session.constants';
import { ATTENDEE_LOGIN_REPOSITORY } from './constants/attendee-login.constants';
import {
  ATTENDEE_PASSWORD_RESET_REPOSITORY,
  PASSWORD_RESET_CODE_STATE,
} from './constants/attendee-password-reset.constants';
import { AttendeeEmailVerificationService } from './services/attendee-email-verification.service';
import { AttendeeRegistrationService } from './services/attendee-registration.service';
import { AttendeeSessionService } from './services/attendee-session.service';
import { AttendeeLoginService } from './services/attendee-login.service';
import { AttendeeIdentityController } from './controllers/attendee-identity.controller';
import { ObservedAttendeeRegistrar } from './observability/observed-attendee-registrar';
import { AttendeeAccountRepository } from './repositories/attendee-account.repository';
import { RabbitMQAttendeeAuthJobPublisher } from './adapters/job-queue/attendee-auth-job.publisher';
import { RedisEmailVerificationOtpState } from './adapters/redis/email-verification-otp.state';
import { RedisAttendeeSessionState } from './adapters/redis/attendee-session.state';
import { RedisPasswordResetCodeState } from './adapters/redis/password-reset-code.state';
import type { AttendeeSessionState } from './types/attendee-session.types';
import type { AttendeeLoginRepository } from './types/attendee-login.types';
import type { AttendeeEmailVerificationRepository } from './types/attendee-email-verification.types';
import type { AttendeeAuthJobPublisher } from './ports/attendee-auth-job.publisher';
import type { EmailVerificationOtpState } from './ports/email-verification-otp.state';
import {
  PASSWORD_HASHER,
  PASSWORD_VERIFIER,
} from '../security/constants/security.constants';
import type { PasswordVerifier } from '../security/types/password-verifier.types';
import type { PasswordHasher } from '../security/types/password-hasher.types';
import { AttendeeAccountService } from './services/attendee-account.service';
import type { AttendeeAccountRepository as AttendeeAccountDetailsRepository } from './types/attendee-account.types';
import type { PasswordResetCodeState } from './ports/password-reset-code.state';
import { AttendeePasswordResetService } from './services/attendee-password-reset.service';
import type { AttendeePasswordResetRepository } from './types/attendee-password-reset.types';

@Module({
  imports: [DatabaseModule, SecurityModule],
  controllers: [AttendeeIdentityController],
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
      useClass: AttendeeAccountRepository,
    },
    {
      provide: ATTENDEE_EMAIL_VERIFICATION_REPOSITORY,
      useExisting: ATTENDEE_ACCOUNT_REPOSITORY,
    },
    {
      provide: ATTENDEE_LOGIN_REPOSITORY,
      useExisting: ATTENDEE_ACCOUNT_REPOSITORY,
    },
    {
      provide: ATTENDEE_PASSWORD_RESET_REPOSITORY,
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
      provide: ATTENDEE_SESSION_STATE,
      useFactory: (redis: RedisClient) => new RedisAttendeeSessionState(redis),
      inject: [RedisClient],
    },
    {
      provide: PASSWORD_RESET_CODE_STATE,
      useFactory: (redis: RedisClient) => new RedisPasswordResetCodeState(redis),
      inject: [RedisClient],
    },
    {
      provide: AttendeeSessionService,
      useFactory: (state: AttendeeSessionState, config: RuntimeConfig) =>
        new AttendeeSessionService(state, config.attendeeSessionHmacSecret),
      inject: [ATTENDEE_SESSION_STATE, RUNTIME_CONFIG],
    },
    {
      provide: AttendeeLoginService,
      useFactory: (
        repository: AttendeeLoginRepository,
        passwordVerifier: PasswordVerifier,
        sessions: AttendeeSessionService,
      ) => new AttendeeLoginService(repository, passwordVerifier, sessions),
      inject: [
        ATTENDEE_LOGIN_REPOSITORY,
        PASSWORD_VERIFIER,
        AttendeeSessionService,
      ],
    },
    {
      provide: AttendeeAccountService,
      useFactory: (repository: AttendeeAccountDetailsRepository) =>
        new AttendeeAccountService(repository),
      inject: [ATTENDEE_ACCOUNT_REPOSITORY],
    },
    {
      provide: RabbitMQClient,
      useFactory: (config: RuntimeConfig) =>
        new RabbitMQClient(config.rabbitMqUrl, config.rabbitMqConnectTimeoutMs),
      inject: [RUNTIME_CONFIG],
    },
    {
      provide: ATTENDEE_AUTH_JOB_PUBLISHER,
      useFactory: (rabbitMQ: RabbitMQClient, config: RuntimeConfig) =>
        new RabbitMQAttendeeAuthJobPublisher(
          rabbitMQ,
          config.rabbitMqPublishTimeoutMs,
        ),
      inject: [RabbitMQClient, RUNTIME_CONFIG],
    },
    {
      provide: AttendeePasswordResetService,
      useFactory: (
        repository: AttendeePasswordResetRepository,
        codeState: PasswordResetCodeState,
        jobPublisher: AttendeeAuthJobPublisher,
        passwordHasher: PasswordHasher,
        sessions: AttendeeSessionService,
        config: RuntimeConfig,
      ) =>
        new AttendeePasswordResetService(
          repository,
          codeState,
          jobPublisher,
          passwordHasher,
          sessions,
          config.passwordResetHmacSecret,
        ),
      inject: [
        ATTENDEE_PASSWORD_RESET_REPOSITORY,
        PASSWORD_RESET_CODE_STATE,
        ATTENDEE_AUTH_JOB_PUBLISHER,
        PASSWORD_HASHER,
        AttendeeSessionService,
        RUNTIME_CONFIG,
      ],
    },
    {
      provide: AttendeeEmailVerificationService,
      useFactory: (
        repository: AttendeeEmailVerificationRepository,
        otpState: EmailVerificationOtpState,
        jobPublisher: AttendeeAuthJobPublisher,
        config: RuntimeConfig,
      ) =>
        new AttendeeEmailVerificationService(
          repository,
          otpState,
          jobPublisher,
          config.emailVerificationHmacSecret,
        ),
      inject: [
        ATTENDEE_EMAIL_VERIFICATION_REPOSITORY,
        EMAIL_VERIFICATION_OTP_STATE,
        ATTENDEE_AUTH_JOB_PUBLISHER,
        RUNTIME_CONFIG,
      ],
    },
  ],
  exports: [
    AttendeeEmailVerificationService,
    AttendeeLoginService,
    AttendeeAccountService,
    AttendeePasswordResetService,
    AttendeeSessionService,
  ],
})
export class AttendeesModule {}
