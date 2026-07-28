import { Module } from '@nestjs/common';

import { RUNTIME_CONFIG } from '../config/runtime.constants';
import type { RuntimeConfig } from '../config/runtime-config';
import { DatabaseModule } from '../database/database.module';
import { RabbitMQClient } from '../infrastructure/clients/rabbitmq.client';
import { RedisClient } from '../infrastructure/clients/redis.client';
import { InfrastructureClientsModule } from '../infrastructure/infrastructure-clients.module';
import { SecurityModule } from '../security/security.module';
import { PASSWORD_HASHER } from '../security/constants/security.constants';
import type { PasswordHasher } from '../security/types/password-hasher.types';
import { RabbitMQAdminAuthJobPublisher } from './adapters/job-queue/admin-auth-job.publisher';
import { RedisAdminActivationOtpState } from './adapters/redis/admin-activation-otp.state';
import { RedisAdminSessionState } from './adapters/redis/admin-session.state';
import {
  ADMIN_ACTIVATION_OTP_STATE,
  ADMIN_ACTIVATION_REPOSITORY,
  ADMIN_AUTH_JOB_PUBLISHER,
} from './constants/admin-activation.constants';
import { ADMIN_SESSION_STATE } from './constants/admin-session.constants';
import { AdminIdentityController } from './controllers/admin-identity.controller';
import { AdminAccountRepository } from './repositories/admin-account.repository';
import { AdminActivationService } from './services/admin-activation.service';
import { AdminLoginService } from './services/admin-login.service';
import { AdminSessionService } from './services/admin-session.service';
import type {
  AdminLoginRepository,
  AdminSessionState,
} from './types/admin-login.types';
import { PASSWORD_VERIFIER } from '../security/constants/security.constants';
import type { PasswordVerifier } from '../security/types/password-verifier.types';

@Module({
  imports: [DatabaseModule, InfrastructureClientsModule, SecurityModule],
  controllers: [AdminIdentityController],
  providers: [
    {
      provide: ADMIN_ACTIVATION_REPOSITORY,
      useClass: AdminAccountRepository,
    },
    {
      provide: ADMIN_ACTIVATION_OTP_STATE,
      useFactory: (redis: RedisClient) =>
        new RedisAdminActivationOtpState(redis),
      inject: [RedisClient],
    },
    {
      provide: ADMIN_SESSION_STATE,
      useFactory: (redis: RedisClient) => new RedisAdminSessionState(redis),
      inject: [RedisClient],
    },
    {
      provide: AdminSessionService,
      useFactory: (state: AdminSessionState, config: RuntimeConfig) =>
        new AdminSessionService(state, config.adminAuthHmacSecret),
      inject: [ADMIN_SESSION_STATE, RUNTIME_CONFIG],
    },
    {
      provide: AdminLoginService,
      useFactory: (
        repository: AdminLoginRepository,
        passwordVerifier: PasswordVerifier,
        sessions: AdminSessionService,
      ) => new AdminLoginService(repository, passwordVerifier, sessions),
      inject: [
        ADMIN_ACTIVATION_REPOSITORY,
        PASSWORD_VERIFIER,
        AdminSessionService,
      ],
    },
    {
      provide: ADMIN_AUTH_JOB_PUBLISHER,
      useFactory: (rabbitMQ: RabbitMQClient, config: RuntimeConfig) =>
        new RabbitMQAdminAuthJobPublisher(
          rabbitMQ,
          config.rabbitMqPublishTimeoutMs,
        ),
      inject: [RabbitMQClient, RUNTIME_CONFIG],
    },
    {
      provide: AdminActivationService,
      useFactory: (
        admins: AdminAccountRepository,
        otpState: RedisAdminActivationOtpState,
        jobPublisher: RabbitMQAdminAuthJobPublisher,
        passwordHasher: PasswordHasher,
        config: RuntimeConfig,
      ) =>
        new AdminActivationService(
          admins,
          otpState,
          jobPublisher,
          passwordHasher,
          config.adminAuthHmacSecret,
        ),
      inject: [
        ADMIN_ACTIVATION_REPOSITORY,
        ADMIN_ACTIVATION_OTP_STATE,
        ADMIN_AUTH_JOB_PUBLISHER,
        PASSWORD_HASHER,
        RUNTIME_CONFIG,
      ],
    },
  ],
})
export class AdminsModule {}
