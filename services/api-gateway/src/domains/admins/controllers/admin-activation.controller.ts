import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  ActivateAdminDto,
  ActivatedAdminDto,
} from '../dto/admin-activation.dto';
import {
  RegisterAdminDto,
  RegisterAdminResponseDto,
} from '../dto/register-admin.dto';
import { AdminClientOriginGuard } from '../guards/admin-client-origin.guard';
import { AdminRegistrationRateLimitGuard } from '../rate-limit/admin-registration-rate-limit';
import { AdminActivationRateLimitGuard } from '../rate-limit/admin-activation-rate-limit';
import { AdminActivationService } from '../services/admin-activation.service';
import { RequestId } from '../../../http/request-id.decorator';

@ApiTags('Admin authentication')
@Controller('auth/admins')
export class AdminActivationController {
  constructor(private readonly adminActivation: AdminActivationService) {}

  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(AdminClientOriginGuard, AdminRegistrationRateLimitGuard)
  @ApiOperation({ summary: 'Request an admin activation code' })
  @ApiResponse({ status: HttpStatus.ACCEPTED, type: RegisterAdminResponseDto })
  register(
    @Body() request: RegisterAdminDto,
    @RequestId() requestId: string,
  ): Promise<RegisterAdminResponseDto> {
    return this.adminActivation.register(request.email, requestId);
  }

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminClientOriginGuard, AdminActivationRateLimitGuard)
  @ApiOperation({ summary: 'Activate a provisioned admin account' })
  @ApiResponse({ status: HttpStatus.OK, type: ActivatedAdminDto })
  activate(
    @Body() request: ActivateAdminDto,
    @RequestId() requestId: string,
  ): Promise<ActivatedAdminDto> {
    return this.adminActivation.activate(
      request.email,
      request.otp,
      request.password,
      requestId,
    );
  }
}
