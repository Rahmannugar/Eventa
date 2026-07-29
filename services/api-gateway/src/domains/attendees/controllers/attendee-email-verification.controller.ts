import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import type {
  ConfirmAttendeeEmailVerificationResponse,
  ResendAttendeeEmailVerificationResponse,
} from '@eventa/grpc-contracts';
import { ApiTags } from '@nestjs/swagger';

import {
  ApiConfirmAttendeeEmailVerification,
  ApiResendAttendeeEmailVerification,
} from '../docs/attendee-email-verification.docs';
import {
  ConfirmAttendeeEmailVerificationDto,
  ResendAttendeeEmailVerificationDto,
} from '../dto/attendee-email-verification.dto';
import {
  AttendeeEmailVerificationConfirmRateLimitGuard,
  AttendeeEmailVerificationResendRateLimitGuard,
} from '../rate-limit/guards/attendee-email-verification-rate-limit.guards';
import { AttendeeEmailVerificationService } from '../services/attendee-email-verification.service';
import { RequestId } from '../../../http/request-id.decorator';

@ApiTags('Attendee authentication')
@Controller('auth/attendees/email-verification')
export class AttendeeEmailVerificationController {
  constructor(
    private readonly emailVerification: AttendeeEmailVerificationService,
  ) {}

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AttendeeEmailVerificationConfirmRateLimitGuard)
  @ApiConfirmAttendeeEmailVerification()
  confirm(
    @Body() request: ConfirmAttendeeEmailVerificationDto,
    @RequestId() requestId: string,
  ): Promise<ConfirmAttendeeEmailVerificationResponse> {
    return this.emailVerification.confirm({
      email: request.email,
      otp: request.otp,
      requestId,
    });
  }

  @Post('resend')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AttendeeEmailVerificationResendRateLimitGuard)
  @ApiResendAttendeeEmailVerification()
  resend(
    @Body() request: ResendAttendeeEmailVerificationDto,
    @RequestId() requestId: string,
  ): Promise<ResendAttendeeEmailVerificationResponse> {
    return this.emailVerification.resend({
      email: request.email,
      requestId,
    });
  }
}
