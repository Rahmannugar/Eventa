import { Controller, Inject } from '@nestjs/common';
import {
  AttendeeIdentityServiceControllerMethods,
  type AttendeeIdentityServiceController,
  type ConfirmAttendeeEmailVerificationResponse,
  type AuthenticateAttendeeSessionResponse,
  type GetCurrentAttendeeAccountResponse,
  type LoginAttendeeResponse,
  type LogoutAttendeeResponse,
  type RegisterAttendeeResponse,
  type ResendAttendeeEmailVerificationResponse,
} from '@eventa/grpc-contracts';
import { Metadata, status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { from, type Observable } from 'rxjs';

import { ATTENDEE_REGISTRAR } from '../constants/attendee-registration.constants';
import {
  EmailVerificationOtpInvalidError,
  EmailVerificationResendRateLimitedError,
  EmailVerificationStateUnavailableError,
} from '../errors/attendee-email-verification.errors';
import {
  EmailAlreadyRegisteredError,
  UsernameUnavailableError,
} from '../errors/attendee-registration.errors';
import {
  ConfirmAttendeeEmailVerificationDto,
  ResendAttendeeEmailVerificationDto,
} from '../dto/attendee-email-verification.dto';
import { RegisterAttendeeDto } from '../dto/register-attendee.dto';
import { LoginAttendeeDto } from '../dto/login-attendee.dto';
import { AttendeeEmailVerificationService } from '../services/attendee-email-verification.service';
import { AttendeeLoginService } from '../services/attendee-login.service';
import type { AttendeeRegistrar } from '../types/attendee-registration.types';
import {
  AttendeeAccountDeletedError,
  AttendeeAccountSuspendedError,
  AttendeeEmailVerificationRequiredError,
  InvalidAttendeeCredentialsError,
} from '../errors/attendee-login.errors';
import { AttendeeSessionStateUnavailableError } from '../errors/attendee-session.errors';
import { InvalidAttendeeSessionError } from '../errors/attendee-session.errors';
import {
  AuthenticateAttendeeSessionDto,
  GetCurrentAttendeeAccountDto,
  LogoutAttendeeDto,
} from '../dto/attendee-session.dto';
import { AttendeeSessionService } from '../services/attendee-session.service';
import { AttendeeAccountService } from '../services/attendee-account.service';

@Controller()
@AttendeeIdentityServiceControllerMethods()
export class AttendeeIdentityController implements AttendeeIdentityServiceController {
  constructor(
    @Inject(ATTENDEE_REGISTRAR)
    private readonly attendeeRegistrar: AttendeeRegistrar,
    private readonly emailVerification: AttendeeEmailVerificationService,
    private readonly attendeeLogin: AttendeeLoginService,
    private readonly attendeeSessions: AttendeeSessionService,
    private readonly attendeeAccounts: AttendeeAccountService,
  ) {}

  registerAttendee(
    request: RegisterAttendeeDto,
  ): Observable<RegisterAttendeeResponse> {
    return from(this.handleRegistration(request));
  }

  loginAttendee(request: LoginAttendeeDto): Observable<LoginAttendeeResponse> {
    return from(this.handleLogin(request));
  }

  authenticateAttendeeSession(
    request: AuthenticateAttendeeSessionDto,
  ): Observable<AuthenticateAttendeeSessionResponse> {
    return from(this.handleSessionAuthentication(request.sessionToken));
  }

  getCurrentAttendeeAccount(
    request: GetCurrentAttendeeAccountDto,
  ): Observable<GetCurrentAttendeeAccountResponse> {
    return from(this.handleCurrentAccount(request.attendeeId));
  }

  logoutAttendee(
    request: LogoutAttendeeDto,
  ): Observable<LogoutAttendeeResponse> {
    return from(this.handleLogout(request.sessionToken));
  }

  confirmAttendeeEmailVerification(
    request: ConfirmAttendeeEmailVerificationDto,
  ): Observable<ConfirmAttendeeEmailVerificationResponse> {
    return from(this.handleConfirmation(request));
  }

  resendAttendeeEmailVerification(
    request: ResendAttendeeEmailVerificationDto,
  ): Observable<ResendAttendeeEmailVerificationResponse> {
    return from(this.handleResend(request));
  }

  private async handleRegistration(
    request: RegisterAttendeeDto,
  ): Promise<RegisterAttendeeResponse> {
    try {
      return await this.attendeeRegistrar.register(request);
    } catch (error: unknown) {
      if (
        error instanceof EmailAlreadyRegisteredError ||
        error instanceof UsernameUnavailableError
      ) {
        throw new RpcException({
          code: status.ALREADY_EXISTS,
          message: error.message,
        });
      }

      throw error;
    }
  }

  private async handleLogin(
    request: LoginAttendeeDto,
  ): Promise<LoginAttendeeResponse> {
    try {
      return await this.attendeeLogin.login(request);
    } catch (error: unknown) {
      if (error instanceof InvalidAttendeeCredentialsError) {
        throw new RpcException({
          code: status.UNAUTHENTICATED,
          message: error.message,
        });
      }

      if (
        error instanceof AttendeeEmailVerificationRequiredError ||
        error instanceof AttendeeAccountDeletedError ||
        error instanceof AttendeeAccountSuspendedError
      ) {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: error.message,
        });
      }

      if (error instanceof AttendeeSessionStateUnavailableError) {
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: error.message,
        });
      }

      throw error;
    }
  }

  private async handleSessionAuthentication(
    token: string,
  ): Promise<AuthenticateAttendeeSessionResponse> {
    try {
      const session = await this.attendeeSessions.require(token);
      return {
        attendeeId: session.attendeeId,
        sessionExpiresAt: session.expiresAt.toISOString(),
        sessionId: session.sessionId,
      };
    } catch (error: unknown) {
      this.translateSessionError(error);
    }
  }

  private async handleCurrentAccount(
    attendeeId: string,
  ): Promise<GetCurrentAttendeeAccountResponse> {
    try {
      return await this.attendeeAccounts.getCurrentAccount(attendeeId);
    } catch (error: unknown) {
      this.translateSessionError(error);
    }
  }

  private async handleLogout(token: string): Promise<LogoutAttendeeResponse> {
    try {
      return { revoked: await this.attendeeSessions.revoke(token) };
    } catch (error: unknown) {
      this.translateSessionError(error);
    }
  }

  private translateSessionError(error: unknown): never {
    if (error instanceof InvalidAttendeeSessionError) {
      throw new RpcException({
        code: status.UNAUTHENTICATED,
        message: error.message,
      });
    }

    if (error instanceof AttendeeSessionStateUnavailableError) {
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: error.message,
      });
    }

    throw error;
  }

  private async handleConfirmation(
    request: ConfirmAttendeeEmailVerificationDto,
  ): Promise<ConfirmAttendeeEmailVerificationResponse> {
    try {
      return await this.emailVerification.confirm(request.email, request.otp);
    } catch (error: unknown) {
      if (error instanceof EmailVerificationOtpInvalidError) {
        throw new RpcException({
          code: status.FAILED_PRECONDITION,
          message: error.message,
        });
      }

      if (error instanceof EmailVerificationStateUnavailableError) {
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: error.message,
        });
      }

      throw error;
    }
  }

  private async handleResend(
    request: ResendAttendeeEmailVerificationDto,
  ): Promise<ResendAttendeeEmailVerificationResponse> {
    try {
      return await this.emailVerification.resend(request.email);
    } catch (error: unknown) {
      if (error instanceof EmailVerificationResendRateLimitedError) {
        const metadata = new Metadata();
        metadata.set('retry-after', String(error.retryAfterSeconds));
        throw new RpcException({
          code: status.RESOURCE_EXHAUSTED,
          message: error.message,
          metadata,
        });
      }

      if (error instanceof EmailVerificationStateUnavailableError) {
        throw new RpcException({
          code: status.UNAVAILABLE,
          message: error.message,
        });
      }

      throw error;
    }
  }
}
