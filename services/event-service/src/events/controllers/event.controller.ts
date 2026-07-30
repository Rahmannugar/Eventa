import {
  EventServiceControllerMethods,
  EventStatus,
  type CreateDraftEventResponse,
  type Event,
  type EventServiceController,
  type GetAdminEventResponse,
} from '@eventa/grpc-contracts';
import { Metadata, status } from '@grpc/grpc-js';
import { Controller, Inject } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { randomUUID } from 'node:crypto';
import { from, type Observable } from 'rxjs';

import { CreateDraftEventDto, GetAdminEventDto } from '../dto/event.dto';
import { EVENT_MANAGEMENT } from '../constants/event.constants';
import { EventNotFoundError } from '../errors/event.errors';
import type { EventManagement, EventRecord } from '../types/event.types';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

@Controller()
@EventServiceControllerMethods()
export class EventController implements EventServiceController {
  constructor(
    @Inject(EVENT_MANAGEMENT)
    private readonly eventService: EventManagement,
  ) {}

  createDraftEvent(
    request: CreateDraftEventDto,
    metadata?: Metadata,
  ): Observable<CreateDraftEventResponse> {
    return from(
      this.eventService
        .createDraft(
          request.adminId,
          request.title,
          this.readRequestId(metadata),
        )
        .then((event) => ({ event: this.toContract(event) })),
    );
  }

  getAdminEvent(request: GetAdminEventDto): Observable<GetAdminEventResponse> {
    return from(this.getEvent(request.eventId));
  }

  private async getEvent(eventId: string): Promise<GetAdminEventResponse> {
    try {
      return {
        event: this.toContract(await this.eventService.getById(eventId)),
      };
    } catch (error: unknown) {
      if (error instanceof EventNotFoundError) {
        throw new RpcException({
          code: status.NOT_FOUND,
          message: error.message,
        });
      }

      throw error;
    }
  }

  private readRequestId(metadata?: Metadata): string {
    const value = metadata?.get('x-request-id')[0];
    return typeof value === 'string' && REQUEST_ID_PATTERN.test(value)
      ? value
      : randomUUID();
  }

  private toContract(event: EventRecord): Event {
    return {
      eventId: event.eventId,
      title: event.title,
      status: EventStatus.EVENT_STATUS_DRAFT,
      createdByAdminId: event.createdByAdminId,
      createdAt: event.createdAt.toISOString(),
      updatedAt: event.updatedAt.toISOString(),
    };
  }
}
