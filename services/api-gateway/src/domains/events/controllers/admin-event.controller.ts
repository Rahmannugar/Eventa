import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { RequestId } from '../../../http/request-id.decorator';
import { AdminAuthenticationGuard } from '../../admins/guards/admin-authentication.guard';
import { AdminClientOriginGuard } from '../../admins/guards/admin-client-origin.guard';
import type { AdminAuthenticatedRequest } from '../../admins/types/authenticated-admin.types';
import {
  AdminEventDto,
  AdminEventPathDto,
  CreateDraftEventDto,
} from '../dto/event.dto';
import {
  AdminEventCreateRateLimitGuard,
  AdminEventReadRateLimitGuard,
} from '../rate-limit/admin-event-rate-limit';
import { AdminEventService } from '../services/admin-event.service';

@ApiTags('Admin events')
@ApiCookieAuth('adminSession')
@Controller('admin/events')
export class AdminEventController {
  constructor(private readonly events: AdminEventService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(
    AdminClientOriginGuard,
    AdminEventCreateRateLimitGuard,
    AdminAuthenticationGuard,
  )
  @ApiOperation({ summary: 'Create a draft event' })
  @ApiResponse({ status: HttpStatus.CREATED, type: AdminEventDto })
  create(
    @Body() input: CreateDraftEventDto,
    @Req() request: AdminAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<AdminEventDto> {
    return this.events.createDraft(
      request.adminSession.adminId,
      input.title,
      requestId,
    );
  }

  @Get(':eventId')
  @UseGuards(
    AdminClientOriginGuard,
    AdminEventReadRateLimitGuard,
    AdminAuthenticationGuard,
  )
  @ApiOperation({ summary: 'Get an event for admin management' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminEventDto })
  get(
    @Param() path: AdminEventPathDto,
    @RequestId() requestId: string,
  ): Promise<AdminEventDto> {
    return this.events.getById(path.eventId, requestId);
  }
}
