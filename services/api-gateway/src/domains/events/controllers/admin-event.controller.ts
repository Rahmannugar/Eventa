import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
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
  AdminEventListDto,
  AdminEventListQueryDto,
  AdminEventMediaUploadPathDto,
  AdminEventMediaPathDto,
  AdminEventPathDto,
  AdminEventTicketTypePathDto,
  CreateDraftEventDto,
  CreateEventMediaUploadDto,
  CreateEventTicketTypeDto,
  CreateEventTicketTypeResponseDto,
  DefineEventTicketCurrencyDto,
  DefineEventTicketCurrencyResponseDto,
  EventTicketTypeListDto,
  EventMediaUploadIntentDto,
  EventMediaUploadStatusDto,
  RemoveEventMediaQueryDto,
  RemoveEventMediaResponseDto,
  PublishEventDto,
  RetireDraftEventQueryDto,
  RetireDraftEventResponseDto,
  RetireEventTicketTypeQueryDto,
  RetireEventTicketTypeResponseDto,
  UpdateDraftEventDto,
  UpdateEventTicketTypeDto,
  UpdateEventTicketTypeResponseDto,
} from '../dto/admin-event.dto';
import {
  AdminEventCreateRateLimitGuard,
  AdminEventMediaStatusRateLimitGuard,
  AdminEventMediaUploadRateLimitGuard,
  AdminEventReadRateLimitGuard,
  AdminEventPublishRateLimitGuard,
  AdminEventRetireRateLimitGuard,
  AdminEventUpdateRateLimitGuard,
  AdminEventTicketTypeRateLimitGuard,
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
      input,
      requestId,
    );
  }

  @Get()
  @UseGuards(
    AdminClientOriginGuard,
    AdminEventReadRateLimitGuard,
    AdminAuthenticationGuard,
  )
  @ApiOperation({ summary: 'List events for admin management' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminEventListDto })
  list(
    @Query() query: AdminEventListQueryDto,
    @RequestId() requestId: string,
  ): Promise<AdminEventListDto> {
    return this.events.list(query, requestId);
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

  @Get(':eventId/ticket-types')
  @UseGuards(
    AdminClientOriginGuard,
    AdminEventReadRateLimitGuard,
    AdminAuthenticationGuard,
  )
  @ApiOperation({ summary: 'List ticket types for an event' })
  @ApiResponse({ status: HttpStatus.OK, type: EventTicketTypeListDto })
  listTicketTypes(
    @Param() path: AdminEventPathDto,
    @RequestId() requestId: string,
  ): Promise<EventTicketTypeListDto> {
    return this.events.listTicketTypes(path.eventId, requestId);
  }

  @Post(':eventId/ticket-types')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(
    AdminClientOriginGuard,
    AdminEventTicketTypeRateLimitGuard,
    AdminAuthenticationGuard,
  )
  @ApiOperation({ summary: 'Create a ticket type for a draft event' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    type: CreateEventTicketTypeResponseDto,
  })
  createTicketType(
    @Param() path: AdminEventPathDto,
    @Body() input: CreateEventTicketTypeDto,
    @Req() request: AdminAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<CreateEventTicketTypeResponseDto> {
    return this.events.createTicketType(
      request.adminSession.adminId,
      path.eventId,
      input,
      requestId,
    );
  }

  @Put(':eventId/ticket-types/:ticketTypeId')
  @UseGuards(
    AdminClientOriginGuard,
    AdminEventTicketTypeRateLimitGuard,
    AdminAuthenticationGuard,
  )
  @ApiOperation({ summary: 'Update a ticket type' })
  @ApiResponse({
    status: HttpStatus.OK,
    type: UpdateEventTicketTypeResponseDto,
  })
  updateTicketType(
    @Param() path: AdminEventTicketTypePathDto,
    @Body() input: UpdateEventTicketTypeDto,
    @Req() request: AdminAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<UpdateEventTicketTypeResponseDto> {
    return this.events.updateTicketType(
      request.adminSession.adminId,
      path.eventId,
      path.ticketTypeId,
      input,
      requestId,
    );
  }

  @Delete(':eventId/ticket-types/:ticketTypeId')
  @UseGuards(
    AdminClientOriginGuard,
    AdminEventTicketTypeRateLimitGuard,
    AdminAuthenticationGuard,
  )
  @ApiOperation({ summary: 'Retire an unused ticket type' })
  @ApiResponse({
    status: HttpStatus.OK,
    type: RetireEventTicketTypeResponseDto,
  })
  retireTicketType(
    @Param() path: AdminEventTicketTypePathDto,
    @Query() query: RetireEventTicketTypeQueryDto,
    @Req() request: AdminAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<RetireEventTicketTypeResponseDto> {
    return this.events.retireTicketType(
      request.adminSession.adminId,
      path.eventId,
      path.ticketTypeId,
      query.expectedVersion,
      requestId,
    );
  }

  @Post(':eventId/ticket-currencies')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(
    AdminClientOriginGuard,
    AdminEventTicketTypeRateLimitGuard,
    AdminAuthenticationGuard,
  )
  @ApiOperation({ summary: 'Define a ticket currency for a draft event' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    type: DefineEventTicketCurrencyResponseDto,
  })
  defineTicketCurrency(
    @Param() path: AdminEventPathDto,
    @Body() input: DefineEventTicketCurrencyDto,
    @Req() request: AdminAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<DefineEventTicketCurrencyResponseDto> {
    return this.events.defineTicketCurrency(
      request.adminSession.adminId,
      path.eventId,
      input,
      requestId,
    );
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

  @Post(':eventId/publish')
  @UseGuards(
    AdminClientOriginGuard,
    AdminEventPublishRateLimitGuard,
    AdminAuthenticationGuard,
  )
  @ApiOperation({ summary: 'Publish a complete draft event' })
  @ApiResponse({ status: HttpStatus.OK, type: AdminEventDto })
  publish(
    @Param() path: AdminEventPathDto,
    @Body() input: PublishEventDto,
    @Req() request: AdminAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<AdminEventDto> {
    return this.events.publish(
      request.adminSession.adminId,
      path.eventId,
      input,
      requestId,
    );
  }

  @Delete(':eventId')
  @UseGuards(
    AdminClientOriginGuard,
    AdminEventRetireRateLimitGuard,
    AdminAuthenticationGuard,
  )
  @ApiOperation({ summary: 'Remove a draft event' })
  @ApiResponse({ status: HttpStatus.OK, type: RetireDraftEventResponseDto })
  retire(
    @Param() path: AdminEventPathDto,
    @Query() query: RetireDraftEventQueryDto,
    @Req() request: AdminAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<RetireDraftEventResponseDto> {
    return this.events.retire(
      request.adminSession.adminId,
      path.eventId,
      query.expectedVersion,
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
    AdminEventMediaStatusRateLimitGuard,
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

  @Delete(':eventId/media/:slot')
  @UseGuards(
    AdminClientOriginGuard,
    AdminEventUpdateRateLimitGuard,
    AdminAuthenticationGuard,
  )
  @ApiOperation({ summary: 'Remove verified event media' })
  @ApiResponse({ status: HttpStatus.OK, type: RemoveEventMediaResponseDto })
  removeMedia(
    @Param() path: AdminEventMediaPathDto,
    @Query() query: RemoveEventMediaQueryDto,
    @Req() request: AdminAuthenticatedRequest,
    @RequestId() requestId: string,
  ): Promise<RemoveEventMediaResponseDto> {
    return this.events.removeMedia(
      request.adminSession.adminId,
      path.eventId,
      path.slot,
      query.expectedVersion,
      requestId,
    );
  }
}
