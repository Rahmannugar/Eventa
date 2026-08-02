import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
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
  AdminEventMediaUploadPathDto,
  AdminEventPathDto,
  CreateDraftEventDto,
  CreateEventMediaUploadDto,
  EventMediaUploadIntentDto,
  EventMediaUploadStatusDto,
  UpdateDraftEventDto,
} from '../dto/event.dto';
import {
  AdminEventCreateRateLimitGuard,
  AdminEventMediaUploadRateLimitGuard,
  AdminEventReadRateLimitGuard,
  AdminEventUpdateRateLimitGuard,
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

  @Put(':eventId')
  @UseGuards(
    AdminClientOriginGuard,
    AdminEventUpdateRateLimitGuard,
    AdminAuthenticationGuard,
  )
  @ApiOperation({ summary: 'Replace editable draft event details' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminEventDto })
  update(
    @Param() path: AdminEventPathDto,
    @Body() input: UpdateDraftEventDto,
    @Req() request: AdminAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<AdminEventDto> {
    return this.events.updateDraft(
      request.adminSession.adminId,
      path.eventId,
      input,
      requestId,
    );
  }

  @Post(':eventId/media-uploads')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(
    AdminClientOriginGuard,
    AdminEventMediaUploadRateLimitGuard,
    AdminAuthenticationGuard,
  )
  @ApiOperation({ summary: 'Create an event media upload intent' })
  @ApiResponse({ status: HttpStatus.CREATED, type: EventMediaUploadIntentDto })
  createMediaUpload(
    @Param() path: AdminEventPathDto,
    @Body() input: CreateEventMediaUploadDto,
    @Req() request: AdminAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<EventMediaUploadIntentDto> {
    return this.events.createMediaUpload(
      request.adminSession.adminId,
      path.eventId,
      input,
      requestId,
    );
  }

  @Get(':eventId/media-uploads/:uploadId')
  @UseGuards(
    AdminClientOriginGuard,
    AdminEventReadRateLimitGuard,
    AdminAuthenticationGuard,
  )
  @ApiOperation({ summary: 'Get event media upload status' })
  @ApiResponse({ status: HttpStatus.OK, type: EventMediaUploadStatusDto })
  getMediaUpload(
    @Param() path: AdminEventMediaUploadPathDto,
    @RequestId() requestId: string,
  ): Promise<EventMediaUploadStatusDto> {
    return this.events.getMediaUpload(path.eventId, path.uploadId, requestId);
  }
}
