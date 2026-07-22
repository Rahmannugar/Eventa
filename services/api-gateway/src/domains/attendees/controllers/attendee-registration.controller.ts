import type { RegisterAttendeeResponse } from '@eventa/grpc-contracts';
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { RegisterAttendeeCommandHandler } from '../commands/register-attendee/register-attendee-command.handler';
import { RegisterAttendeeCommand } from '../commands/register-attendee/register-attendee.command';
import { ApiRegisterAttendee } from '../docs/attendee-registration.docs';
import { RegisterAttendeeDto } from '../dto/register-attendee.dto';
import { AttendeeRegistrationRateLimitGuard } from '../rate-limit/guards/attendee-registration-rate-limit.guard';

@ApiTags('Attendee authentication')
@Controller('auth/attendees')
export class AttendeeRegistrationController {
  constructor(
    private readonly registerAttendee: RegisterAttendeeCommandHandler,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AttendeeRegistrationRateLimitGuard)
  @ApiRegisterAttendee()
  register(
    @Body() request: RegisterAttendeeDto,
    @Headers('x-request-id') requestId: string,
  ): Promise<RegisterAttendeeResponse> {
    return this.registerAttendee.handle(
      new RegisterAttendeeCommand(
        request.email,
        request.password,
        request.username,
        requestId,
      ),
    );
  }
}
