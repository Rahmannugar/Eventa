import { Controller, Inject } from '@nestjs/common';
import {
  AttendeeIdentityServiceControllerMethods,
  type AttendeeIdentityServiceController,
  type RegisterAttendeeResponse,
} from '@eventa/grpc-contracts';
import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { from, type Observable } from 'rxjs';

import { ATTENDEE_REGISTRAR } from '../constants/attendee-registration.constants';
import {
  EmailAlreadyRegisteredError,
  UsernameUnavailableError,
} from '../errors/attendee-registration.errors';
import { RegisterAttendeeDto } from '../dto/register-attendee.dto';
import type { AttendeeRegistrar } from '../types/attendee-registration.types';

@Controller()
@AttendeeIdentityServiceControllerMethods()
export class AttendeeRegistrationController implements AttendeeIdentityServiceController {
  constructor(
    @Inject(ATTENDEE_REGISTRAR)
    private readonly attendeeRegistrar: AttendeeRegistrar,
  ) {}

  registerAttendee(
    request: RegisterAttendeeDto,
  ): Observable<RegisterAttendeeResponse> {
    return from(this.handleRegistration(request));
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
}
