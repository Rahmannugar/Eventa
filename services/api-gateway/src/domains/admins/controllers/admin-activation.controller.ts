import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  Response,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  CompleteAdminActivationDto,
  CompletedAdminActivationDto,
  ConfirmAdminActivationDto,
  ConfirmedAdminActivationDto,
} from '../dto/admin-activation.dto';
import {
  RegisterAdminDto,
  RegisterAdminResponseDto,
} from '../dto/register-admin.dto';
import { AdminClientOriginGuard } from '../guards/admin-client-origin.guard';
import { AdminRegistrationRateLimitGuard } from '../rate-limit/admin-registration-rate-limit';
import {
  AdminActivationCompleteRateLimitGuard,
  AdminActivationConfirmRateLimitGuard,
} from '../rate-limit/admin-activation-rate-limit';
import {
  AdminActivationCookie,
  type AdminActivationCookieResponse,
} from '../services/admin-activation-cookie.service';
import { AdminActivationService } from '../services/admin-activation.service';

@ApiTags('Admin authentication')
@Controller('auth/admins')
export class AdminActivationController {
  constructor(
    private readonly adminActivation: AdminActivationService,
    private readonly activationCookie: AdminActivationCookie,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AdminClientOriginGuard, AdminRegistrationRateLimitGuard)
  @ApiOperation({ summary: 'Request an admin activation code' })
  @ApiResponse({ status: HttpStatus.ACCEPTED, type: RegisterAdminResponseDto })
  register(
    @Body() request: RegisterAdminDto,
    @Headers('x-request-id') requestId: string,
  ): Promise<RegisterAdminResponseDto> {
    return this.adminActivation.register(request.email, requestId);
  }

  @Post('activation/confirm')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminClientOriginGuard, AdminActivationConfirmRateLimitGuard)
  @ApiOperation({ summary: 'Confirm an admin activation code' })
  @ApiResponse({ status: HttpStatus.OK, type: ConfirmedAdminActivationDto })
  async confirm(
    @Body() request: ConfirmAdminActivationDto,
    @Headers('x-request-id') requestId: string,
    @Response({ passthrough: true }) response: AdminActivationCookieResponse,
  ): Promise<ConfirmedAdminActivationDto> {
    const result = await this.adminActivation.confirm(
      request.email,
      request.otp,
      requestId,
    );
    this.activationCookie.set(
      response,
      result.activationToken,
      result.expiresAt,
    );
    return { activationReady: true };
  }

  @Post('activation/complete')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminClientOriginGuard, AdminActivationCompleteRateLimitGuard)
  @ApiOperation({ summary: 'Set the first admin password' })
  @ApiResponse({ status: HttpStatus.OK, type: CompletedAdminActivationDto })
  async complete(
    @Body() request: CompleteAdminActivationDto,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('x-request-id') requestId: string,
    @Res({ passthrough: true }) response: AdminActivationCookieResponse,
  ): Promise<CompletedAdminActivationDto> {
    const result = await this.adminActivation.complete(
      this.activationCookie.read(cookieHeader),
      request.password,
      requestId,
    );
    this.activationCookie.clear(response);
    return result;
  }
}
