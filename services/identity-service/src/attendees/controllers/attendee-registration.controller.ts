import { Controller, Inject } from '@nestjs/common';
import {
  ATTENDEE_IDENTITY_SERVICE_NAME,
  type AttendeeIdentityServiceController,
  type RegisterAttendeeResponse,
} from '@eventa/grpc-contracts';
import { status } from '@grpc/grpc-js';
import { GrpcMethod, RpcException } from '@nestjs/microservices';

import { RegisterAttendeeCommand } from '../commands/register-attendee/register-attendee.command';
import { REGISTER_ATTENDEE_HANDLER } from '../constants/attendee-registration.constants';
import {
  EmailAlreadyRegisteredError,
  UsernameUnavailableError,
} from '../errors/attendee-registration.errors';
import { RegisterAttendeeDto } from '../dto/register-attendee.dto';
import type { RegisterAttendeeHandler } from '../commands/register-attendee/register-attendee.command';

@Controller()
export class AttendeeRegistrationController implements AttendeeIdentityServiceController {
  constructor(
    @Inject(REGISTER_ATTENDEE_HANDLER)
    private readonly registerAttendeeHandler: RegisterAttendeeHandler,
  ) {}

  @GrpcMethod(ATTENDEE_IDENTITY_SERVICE_NAME, 'RegisterAttendee')
  async registerAttendee(
    request: RegisterAttendeeDto,
  ): Promise<RegisterAttendeeResponse> {
    try {
      return await this.registerAttendeeHandler.handle(
        new RegisterAttendeeCommand(
          request.email,
          request.password,
          request.username,
        ),
      );
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
