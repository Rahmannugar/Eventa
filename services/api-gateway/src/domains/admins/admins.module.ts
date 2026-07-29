import { Module, type DynamicModule } from '@nestjs/common';
import {
  EVENTA_IDENTITY_V1_PACKAGE_NAME,
  getIdentityProtoIncludeDirs,
  getIdentityProtoPaths,
} from '@eventa/grpc-contracts';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { RATE_LIMIT_STATE } from '../../rate-limit/constants/rate-limit.constants';
import type { RateLimitState } from '../../rate-limit/ports/rate-limit.state';
import {
  ADMIN_CLIENT_ORIGIN,
  ADMIN_IDENTITY_GRPC_CLIENT,
  ADMIN_IDENTITY_GRPC_DEADLINE_MS,
} from './constants/admin-registration.constants';
import { AdminActivationController } from './controllers/admin-activation.controller';
import { AdminLoginController } from './controllers/admin-login.controller';
import { AdminSessionController } from './controllers/admin-session.controller';
import { AdminPasswordResetController } from './controllers/admin-password-reset.controller';
import { AdminClientOriginGuard } from './guards/admin-client-origin.guard';
import { AdminAuthenticationGuard } from './guards/admin-authentication.guard';
import {
  AdminRegistrationRateLimitGuard,
  AdminRegistrationRateLimitService,
} from './rate-limit/admin-registration-rate-limit';
import {
  AdminActivationRateLimitGuard,
  AdminActivationRateLimitService,
} from './rate-limit/admin-activation-rate-limit';
import { AdminActivationService } from './services/admin-activation.service';
import {
  AdminLoginRateLimitGuard,
  AdminLoginRateLimitService,
} from './rate-limit/admin-login-rate-limit';
import { AdminLoginService } from './services/admin-login.service';
import { AdminSessionCookie } from './services/admin-session-cookie.service';
import { AdminSessionService } from './services/admin-session.service';
import { AdminPasswordResetService } from './services/admin-password-reset.service';
import {
  AdminAccountRateLimitGuard,
  AdminLogoutRateLimitGuard,
  AdminSessionRateLimitService,
} from './rate-limit/admin-session-rate-limit';
import {
  AdminForgotPasswordRateLimitGuard,
  AdminPasswordResetRateLimitService,
  AdminResetPasswordRateLimitGuard,
} from './rate-limit/admin-password-reset-rate-limit';

interface AdminsModuleOptions {
  adminClientOrigin: string;
  identityGrpcDeadlineMs: number;
  identityGrpcUrl: string;
  rateLimitKeySecret: string;
  secureCookies: boolean;
}

@Module({})
export class AdminsModule {
  static register(options: AdminsModuleOptions): DynamicModule {
    return {
      module: AdminsModule,
      imports: [
        ClientsModule.register([
          {
            name: ADMIN_IDENTITY_GRPC_CLIENT,
            transport: Transport.GRPC,
            options: {
              package: EVENTA_IDENTITY_V1_PACKAGE_NAME,
              protoPath: getIdentityProtoPaths(),
              loader: { includeDirs: getIdentityProtoIncludeDirs() },
              url: options.identityGrpcUrl,
            },
          },
        ]),
      ],
      controllers: [
        AdminActivationController,
        AdminLoginController,
        AdminPasswordResetController,
        AdminSessionController,
      ],
      providers: [
        {
          provide: ADMIN_CLIENT_ORIGIN,
          useValue: options.adminClientOrigin,
        },
        {
          provide: ADMIN_IDENTITY_GRPC_DEADLINE_MS,
          useValue: options.identityGrpcDeadlineMs,
        },
        AdminActivationService,
        AdminLoginService,
        AdminPasswordResetService,
        AdminSessionService,
        {
          provide: AdminPasswordResetRateLimitService,
          useFactory: (state: RateLimitState) =>
            new AdminPasswordResetRateLimitService(
              state,
              options.rateLimitKeySecret,
            ),
          inject: [RATE_LIMIT_STATE],
        },
        {
          provide: AdminSessionRateLimitService,
          useFactory: (state: RateLimitState) =>
            new AdminSessionRateLimitService(state, options.rateLimitKeySecret),
          inject: [RATE_LIMIT_STATE],
        },
        {
          provide: AdminSessionCookie,
          useFactory: () => new AdminSessionCookie(options.secureCookies),
        },
        {
          provide: AdminLoginRateLimitService,
          useFactory: (state: RateLimitState) =>
            new AdminLoginRateLimitService(state, options.rateLimitKeySecret),
          inject: [RATE_LIMIT_STATE],
        },
        {
          provide: AdminActivationRateLimitService,
          useFactory: (state: RateLimitState) =>
            new AdminActivationRateLimitService(
              state,
              options.rateLimitKeySecret,
            ),
          inject: [RATE_LIMIT_STATE],
        },
        {
          provide: AdminRegistrationRateLimitService,
          useFactory: (state: RateLimitState) =>
            new AdminRegistrationRateLimitService(
              state,
              options.rateLimitKeySecret,
            ),
          inject: [RATE_LIMIT_STATE],
        },
        AdminClientOriginGuard,
        AdminAuthenticationGuard,
        AdminForgotPasswordRateLimitGuard,
        AdminResetPasswordRateLimitGuard,
        AdminAccountRateLimitGuard,
        AdminLogoutRateLimitGuard,
        AdminActivationRateLimitGuard,
        AdminLoginRateLimitGuard,
        AdminRegistrationRateLimitGuard,
      ],
    };
  }
}
