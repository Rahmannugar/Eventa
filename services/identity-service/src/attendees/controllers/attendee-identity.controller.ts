import { Controller, Inject } from '@nestjs/common';
import {
  AttendeeIdentityServiceControllerMethods,
  type AttendeeIdentityServiceController,
  type ConfirmAttendeeEmailVerificationResponse,
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
import { AttendeeEmailVerificationService } from '../services/attendee-email-verification.service';
import type { AttendeeRegistrar } from '../types/attendee-registration.types';

@Controller()
@AttendeeIdentityServiceControllerMethods()
export class AttendeeIdentityController implements AttendeeIdentityServiceController {
  constructor(
    @Inject(ATTENDEE_REGISTRAR)
    private readonly attendeeRegistrar: AttendeeRegistrar,
    private readonly emailVerification: AttendeeEmailVerificationService,
  ) {}

  registerAttendee(
    request: RegisterAttendeeDto,
  ): Observable<RegisterAttendeeResponse> {
    return from(this.handleRegistration(request));
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
