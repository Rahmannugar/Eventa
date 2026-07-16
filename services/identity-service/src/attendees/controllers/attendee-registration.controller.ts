import { Controller } from '@nestjs/common';
import {
  ATTENDEE_IDENTITY_SERVICE_NAME,
  type AttendeeIdentityServiceController,
  type RegisterAttendeeResponse,
} from '@eventa/grpc-contracts';
import { status } from '@grpc/grpc-js';
import { GrpcMethod, RpcException } from '@nestjs/microservices';

import {
  EmailAlreadyRegisteredError,
  UsernameUnavailableError,
} from '../errors/attendee-registration.errors';
import { RegisterAttendeeDto } from '../dto/register-attendee.dto';
import { RegisterAttendeeService } from '../services/register-attendee.service';

@Controller()
export class AttendeeRegistrationController implements AttendeeIdentityServiceController {
  constructor(
    private readonly registerAttendeeService: RegisterAttendeeService,
  ) {}

  @GrpcMethod(ATTENDEE_IDENTITY_SERVICE_NAME, 'RegisterAttendee')
  async registerAttendee(
    request: RegisterAttendeeDto,
  ): Promise<RegisterAttendeeResponse> {
    try {
      return await this.registerAttendeeService.register(request);
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
