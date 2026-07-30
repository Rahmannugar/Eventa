import {
  EVENT_SERVICE_NAME,
  EventStatus,
  type Event,
} from '@eventa/grpc-contracts';
import { Metadata, status } from '@grpc/grpc-js';
import {
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

import { ApiHttpException } from '../../../http/errors/api-http.exception';
import {
  EVENT_GRPC_CLIENT,
  EVENT_GRPC_DEADLINE_MS,
} from '../constants/event.constants';
import type { AdminEventDto } from '../dto/event.dto';
import type { DeadlineAwareEventServiceClient } from '../types/event-grpc-client.types';

function readErrorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Reflect.get(error, 'code')
    : undefined;
}

@Injectable()
export class AdminEventService implements OnModuleInit {
  private events?: DeadlineAwareEventServiceClient;

  constructor(
    @Inject(EVENT_GRPC_CLIENT)
    private readonly grpcClient: ClientGrpc,
    @Inject(EVENT_GRPC_DEADLINE_MS)
    private readonly deadlineMs: number,
  ) {}

  onModuleInit(): void {
    this.events =
      this.grpcClient.getService<DeadlineAwareEventServiceClient>(
        EVENT_SERVICE_NAME,
      );
  }

  async createDraft(
    adminId: string,
    title: string,
    requestId: string,
  ): Promise<AdminEventDto> {
    const events = this.requireClient();

    try {
      const response = await firstValueFrom(
        events.createDraftEvent(
          { adminId, title },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
      return this.toAdminEvent(response.event);
    } catch (error: unknown) {
      this.translate(error, 'create');
    }
  }

  async getById(eventId: string, requestId: string): Promise<AdminEventDto> {
    const events = this.requireClient();

    try {
      const response = await firstValueFrom(
        events.getAdminEvent(
          { eventId },
          this.metadata(requestId),
          this.deadline(),
        ),
      );
      return this.toAdminEvent(response.event);
    } catch (error: unknown) {
      this.translate(error, 'read');
    }
  }

  private deadline() {
    return { deadline: new Date(Date.now() + this.deadlineMs) };
  }

  private metadata(requestId: string): Metadata {
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    return metadata;
  }

  private requireClient(): DeadlineAwareEventServiceClient {
    if (this.events === undefined) {
      throw this.unavailable('EVENT_CLIENT_UNAVAILABLE');
    }

    return this.events;
  }

  private toAdminEvent(event: Event | undefined): AdminEventDto {
    if (
      event === undefined ||
      event.status !== EventStatus.EVENT_STATUS_DRAFT
    ) {
      throw this.unavailable('EVENT_RESPONSE_INVALID');
    }

    return {
      eventId: event.eventId,
      title: event.title,
      status: 'draft',
      createdByAdminId: event.createdByAdminId,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    };
  }

  private translate(error: unknown, operation: 'create' | 'read'): never {
    switch (readErrorCode(error)) {
      case status.NOT_FOUND:
        throw new ApiHttpException(
          HttpStatus.NOT_FOUND,
          'EVENT_NOT_FOUND',
          'Event was not found.',
        );
      case status.INVALID_ARGUMENT:
        throw new ApiHttpException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'VALIDATION_FAILED',
          'Check the event fields and try again.',
          { diagnosticCode: 'EVENT_VALIDATION_FAILED' },
        );
      case status.DEADLINE_EXCEEDED:
        throw this.unavailable('EVENT_RPC_DEADLINE_EXCEEDED');
      default:
        throw this.unavailable(
          operation === 'create'
            ? 'EVENT_CREATE_RPC_UNAVAILABLE'
            : 'EVENT_READ_RPC_UNAVAILABLE',
        );
    }
  }

  private unavailable(diagnosticCode: string): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'EVENT_SERVICE_UNAVAILABLE',
      'Event management is temporarily unavailable. Try again later.',
      { diagnosticCode },
    );
  }
}
