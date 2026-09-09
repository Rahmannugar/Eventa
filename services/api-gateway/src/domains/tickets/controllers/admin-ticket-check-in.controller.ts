import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequestId } from '../../../http/request-id.decorator';
import { AdminAuthenticationGuard } from '../../admins/guards/admin-authentication.guard';
import type { AdminAuthenticatedRequest } from '../../admins/types/authenticated-admin.types';
import { AdminTicketCheckInDto, AdminTicketCheckInPathDto, AdminTicketCheckInResponseDto } from '../dto/admin-ticket-check-in.dto';
import { AdminTicketCheckInService } from '../services/admin-ticket-check-in.service';

@ApiTags('Admin tickets') @ApiCookieAuth('adminSession') @Controller('admin/events/:eventId/check-ins')
export class AdminTicketCheckInController {
  constructor(private readonly checkIns: AdminTicketCheckInService) {}

  @Post()
  @UseGuards(AdminAuthenticationGuard)
  @ApiOkResponse({ type: AdminTicketCheckInResponseDto })
  checkIn(@Param() path: AdminTicketCheckInPathDto, @Body() input: AdminTicketCheckInDto, @Req() request: AdminAuthenticatedRequest, @RequestId() requestId: string): Promise<AdminTicketCheckInResponseDto> {
    return this.checkIns.checkIn(path.eventId, input.qrToken, request.adminSession.adminId, requestId);
  }
}
