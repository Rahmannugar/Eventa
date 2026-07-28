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
  IDENTITY_GRPC_CLIENT,
  IDENTITY_GRPC_DEADLINE_MS,
} from './constants/attendee-registration.constants';
import { AttendeeRegistrationService } from './services/attendee-registration.service';
import { AttendeeRegistrationController } from './controllers/attendee-registration.controller';
import { AttendeeEmailVerificationController } from './controllers/attendee-email-verification.controller';
import { AttendeeEmailVerificationService } from './services/attendee-email-verification.service';
import {
  AttendeeEmailVerificationConfirmRateLimitGuard,
  AttendeeEmailVerificationResendRateLimitGuard,
} from './rate-limit/guards/attendee-email-verification-rate-limit.guards';
import { AttendeeEmailVerificationRateLimitService } from './rate-limit/services/attendee-email-verification-rate-limit.service';
import { AttendeeRegistrationRateLimitGuard } from './rate-limit/guards/attendee-registration-rate-limit.guard';
import { AttendeeRegistrationRateLimitService } from './rate-limit/services/attendee-registration-rate-limit.service';
import { AttendeeLoginController } from './controllers/attendee-login.controller';
import { AttendeeLoginService } from './services/attendee-login.service';
import { AttendeeLoginRateLimitGuard } from './rate-limit/guards/attendee-login-rate-limit.guard';
import { AttendeeLoginRateLimitService } from './rate-limit/services/attendee-login-rate-limit.service';
import { ATTENDEE_CLIENT_ORIGIN } from './constants/attendee-login.constants';
import { AttendeeSessionCookie } from './services/attendee-session-cookie.service';
import { AttendeeClientOriginGuard } from './guards/attendee-client-origin.guard';
import { AttendeeSessionController } from './controllers/attendee-session.controller';
import { AttendeeSessionService } from './services/attendee-session.service';
import { AttendeeAuthenticationGuard } from './guards/attendee-authentication.guard';
import { AttendeeSessionRateLimitService } from './rate-limit/services/attendee-session-rate-limit.service';
import {
  AttendeeLogoutRateLimitGuard,
  AttendeeAccountRateLimitGuard,
  AttendeeDeletionRateLimitGuard,
} from './rate-limit/guards/attendee-session-rate-limit.guards';
import { AttendeePasswordResetController } from './controllers/attendee-password-reset.controller';
import { AttendeePasswordResetService } from './services/attendee-password-reset.service';
import { AttendeePasswordResetRateLimitService } from './rate-limit/services/attendee-password-reset-rate-limit.service';
import {
  AttendeeForgotPasswordRateLimitGuard,
  AttendeeResetPasswordRateLimitGuard,
} from './rate-limit/guards/attendee-password-reset-rate-limit.guards';

interface AttendeesModuleOptions {
  attendeeClientOrigin: string;
  identityGrpcDeadlineMs: number;
  identityGrpcUrl: string;
  rateLimitKeySecret: string;
  secureSessionCookie: boolean;
}

@Module({})
export class AttendeesModule {
  static register(options: AttendeesModuleOptions): DynamicModule {
    return {
      module: AttendeesModule,
      imports: [
        ClientsModule.register([
          {
            name: IDENTITY_GRPC_CLIENT,
            transport: Transport.GRPC,
            options: {
              package: EVENTA_IDENTITY_V1_PACKAGE_NAME,
              protoPath: getIdentityProtoPaths(),
              loader: {
                includeDirs: getIdentityProtoIncludeDirs(),
              },
              url: options.identityGrpcUrl,
            },
          },
        ]),
      ],
      controllers: [
        AttendeeEmailVerificationController,
        AttendeeLoginController,
        AttendeePasswordResetController,
        AttendeeRegistrationController,
        AttendeeSessionController,
      ],
      providers: [
        {
          provide: IDENTITY_GRPC_DEADLINE_MS,
          useValue: options.identityGrpcDeadlineMs,
        },
        AttendeeEmailVerificationService,
        AttendeeLoginService,
        AttendeePasswordResetService,
        AttendeeRegistrationService,
        AttendeeSessionService,
        {
          provide: ATTENDEE_CLIENT_ORIGIN,
          useValue: options.attendeeClientOrigin,
        },
        {
          provide: AttendeeSessionCookie,
          useFactory: () =>
            new AttendeeSessionCookie(options.secureSessionCookie),
        },
        {
          provide: AttendeePasswordResetRateLimitService,
          useFactory: (state: RateLimitState) =>
            new AttendeePasswordResetRateLimitService(
              state,
              options.rateLimitKeySecret,
            ),
          inject: [RATE_LIMIT_STATE],
        },
        {
          provide: AttendeeSessionRateLimitService,
          useFactory: (state: RateLimitState) =>
            new AttendeeSessionRateLimitService(
              state,
              options.rateLimitKeySecret,
            ),
          inject: [RATE_LIMIT_STATE],
        },
        {
          provide: AttendeeLoginRateLimitService,
          useFactory: (state: RateLimitState) =>
            new AttendeeLoginRateLimitService(
              state,
              options.rateLimitKeySecret,
            ),
          inject: [RATE_LIMIT_STATE],
        },
        {
          provide: AttendeeEmailVerificationRateLimitService,
          useFactory: (state: RateLimitState) =>
            new AttendeeEmailVerificationRateLimitService(
              state,
              options.rateLimitKeySecret,
            ),
          inject: [RATE_LIMIT_STATE],
        },
        {
          provide: AttendeeRegistrationRateLimitService,
          useFactory: (state: RateLimitState) =>
            new AttendeeRegistrationRateLimitService(
              state,
              options.rateLimitKeySecret,
            ),
          inject: [RATE_LIMIT_STATE],
        },
        AttendeeClientOriginGuard,
        AttendeeAuthenticationGuard,
        AttendeeAccountRateLimitGuard,
        AttendeeDeletionRateLimitGuard,
        AttendeeForgotPasswordRateLimitGuard,
        AttendeeLogoutRateLimitGuard,
        AttendeeLoginRateLimitGuard,
        AttendeeRegistrationRateLimitGuard,
        AttendeeResetPasswordRateLimitGuard,
        AttendeeEmailVerificationConfirmRateLimitGuard,
        AttendeeEmailVerificationResendRateLimitGuard,
      ],
    };
  }
}
