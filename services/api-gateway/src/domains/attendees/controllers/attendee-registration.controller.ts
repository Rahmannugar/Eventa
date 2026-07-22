import type { RegisterAttendeeResponse } from '@eventa/grpc-contracts';
import {
  Body,
  All,
  Controller,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';

import { ApiRegisterAttendee } from '../docs/attendee-registration.docs';
import { RegisterAttendeeDto } from '../dto/register-attendee.dto';
import { AttendeeRegistrationRateLimitGuard } from '../rate-limit/guards/attendee-registration-rate-limit.guard';
import { AttendeeRegistrationService } from '../services/attendee-registration.service';
import { ApiHttpException } from '../../../http/errors/api-http.exception';

@ApiTags('Attendee authentication')
@Controller('auth/attendees')
export class AttendeeRegistrationController {
  constructor(
    private readonly attendeeRegistrationService: AttendeeRegistrationService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AttendeeRegistrationRateLimitGuard)
  @ApiRegisterAttendee()
  register(
    @Body() request: RegisterAttendeeDto,
    @Headers('x-request-id') requestId: string,
  ): Promise<RegisterAttendeeResponse> {
    return this.attendeeRegistrationService.register(request, requestId);
  }

  @All('register')
  @Header('Allow', 'POST')
  @ApiExcludeEndpoint()
  methodNotAllowed(): never {
    throw new ApiHttpException(
      HttpStatus.METHOD_NOT_ALLOWED,
      'METHOD_NOT_ALLOWED',
      'Use POST to register an attendee.',
    );
  }
}
