import {
  EVENT_SERVICE_NAME,
  EventWaitlistEntryStatus,
  type EventWaitlistEntry,
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
import type {
  EventWaitlistEntryDto,
  EventWaitlistPathDto,
} from '../dto/event-waitlist.dto';
import type { DeadlineAwareEventServiceClient } from '../types/event-grpc-client.types';

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? Reflect.get(error, 'code')
    : undefined;
}

function errorDetails(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'details' in error
    ? Reflect.get(error, 'details')
    : undefined;
}

@Injectable()
export class EventWaitlistService implements OnModuleInit {
  private events?: DeadlineAwareEventServiceClient;

  constructor(
    @Inject(EVENT_GRPC_CLIENT) private readonly grpcClient: ClientGrpc,
    @Inject(EVENT_GRPC_DEADLINE_MS) private readonly deadlineMs: number,
  ) {}

  onModuleInit(): void {
    this.events =
      this.grpcClient.getService<DeadlineAwareEventServiceClient>(
        EVENT_SERVICE_NAME,
      );
  }

  async join(
    path: EventWaitlistPathDto,
    attendeeId: string,
    quantity: number,
    requestId: string,
  ): Promise<EventWaitlistEntryDto> {
    try {
      const response = await firstValueFrom(
        this.requireClient().joinEventWaitlist(
          { ...path, attendeeId, quantity },
          this.metadata(requestId),
          this.options(),
        ),
      );
      return this.toDto(response.entry, attendeeId);
    } catch (error: unknown) {
      this.translate(error);
    }
  }

  async get(
    path: EventWaitlistPathDto,
    attendeeId: string,
    requestId: string,
  ): Promise<EventWaitlistEntryDto> {
    try {
      const response = await firstValueFrom(
        this.requireClient().getEventWaitlistEntry(
          { ...path, attendeeId },
          this.metadata(requestId),
          this.options(),
        ),
      );
      return this.toDto(response.entry, attendeeId);
    } catch (error: unknown) {
      this.translate(error);
    }
  }

  async leave(
    path: EventWaitlistPathDto,
    attendeeId: string,
    requestId: string,
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.requireClient().leaveEventWaitlist(
          { ...path, attendeeId },
          this.metadata(requestId),
          this.options(),
        ),
      );
    } catch (error: unknown) {
      this.translate(error);
    }
  }

  private toDto(
    entry: EventWaitlistEntry | undefined,
    attendeeId: string,
  ): EventWaitlistEntryDto {
    const statusValue = entry?.status;
    if (
      entry === undefined ||
      entry.attendeeId !== attendeeId ||
      entry.waitlistEntryId === '' ||
      entry.eventId === '' ||
      entry.ticketTypeId === '' ||
      !Number.isInteger(entry.quantity) ||
      entry.quantity < 1 ||
      entry.createdAt === '' ||
      entry.updatedAt === '' ||
      (statusValue !==
        EventWaitlistEntryStatus.EVENT_WAITLIST_ENTRY_STATUS_WAITING &&
        statusValue !==
          EventWaitlistEntryStatus.EVENT_WAITLIST_ENTRY_STATUS_ELIGIBLE) ||
      (statusValue ===
        EventWaitlistEntryStatus.EVENT_WAITLIST_ENTRY_STATUS_WAITING &&
        (!Number.isInteger(entry.position) ||
          (entry.position ?? 0) < 1 ||
          entry.eligibleAt !== undefined ||
          entry.opportunityExpiresAt !== undefined)) ||
      (statusValue ===
        EventWaitlistEntryStatus.EVENT_WAITLIST_ENTRY_STATUS_ELIGIBLE &&
        (entry.position !== undefined ||
          entry.eligibleAt === undefined ||
          entry.eligibleAt === '' ||
          entry.opportunityExpiresAt === undefined ||
          entry.opportunityExpiresAt === ''))
    ) {
      throw this.unavailable('EVENT_WAITLIST_RESPONSE_INVALID');
    }
    return {
      waitlistEntryId: entry.waitlistEntryId,
      eventId: entry.eventId,
      ticketTypeId: entry.ticketTypeId,
      quantity: entry.quantity,
      status:
        statusValue ===
        EventWaitlistEntryStatus.EVENT_WAITLIST_ENTRY_STATUS_ELIGIBLE
          ? 'eligible'
          : 'waiting',
      position: entry.position ?? null,
      ...(entry.eligibleAt === undefined
        ? {}
        : { eligibleAt: entry.eligibleAt }),
      ...(entry.opportunityExpiresAt === undefined
        ? {}
        : { opportunityExpiresAt: entry.opportunityExpiresAt }),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }

  private translate(error: unknown): never {
    const code = errorCode(error);
    const details = errorDetails(error);
    if (code === status.NOT_FOUND) {
      throw new ApiHttpException(
        HttpStatus.NOT_FOUND,
        details === 'EVENT_WAITLIST_ENTRY_NOT_FOUND'
          ? 'WAITLIST_ENTRY_NOT_FOUND'
          : 'TICKET_TYPE_NOT_FOUND',
        'Waitlist entry was not found.',
      );
    }
    if (code === status.FAILED_PRECONDITION) {
      if (details === 'EVENT_TICKET_CAPACITY_AVAILABLE') {
        throw new ApiHttpException(
          HttpStatus.CONFLICT,
          'TICKETS_AVAILABLE',
          'Tickets are available for this ticket type.',
        );
      }
      if (details === 'EVENT_WAITLIST_FULL') {
        throw new ApiHttpException(
          HttpStatus.CONFLICT,
          'WAITLIST_FULL',
          'The waitlist is full.',
        );
      }
      if (details === 'EVENT_WAITLIST_QUANTITY_CONFLICT') {
        throw new ApiHttpException(
          HttpStatus.CONFLICT,
          'WAITLIST_QUANTITY_CONFLICT',
          'Leave the waitlist before changing your quantity.',
        );
      }
      if (details === 'EVENT_WAITLIST_ACTIVE_RESERVATION_CONFLICT') {
        throw new ApiHttpException(
          HttpStatus.CONFLICT,
          'ACTIVE_RESERVATION_EXISTS',
          'You already have tickets reserved for this ticket type.',
        );
      }
      throw new ApiHttpException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'TICKET_SALES_UNAVAILABLE',
        'Waitlisting is not available for this ticket type.',
      );
    }
    if (code === status.DEADLINE_EXCEEDED)
      throw this.unavailable('EVENT_WAITLIST_RPC_DEADLINE_EXCEEDED');
    if (error instanceof ApiHttpException) throw error;
    throw this.unavailable('EVENT_WAITLIST_RPC_UNAVAILABLE');
  }

  private metadata(requestId: string): Metadata {
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    return metadata;
  }

  private options() {
    return { deadline: new Date(Date.now() + this.deadlineMs) };
  }

  private requireClient(): DeadlineAwareEventServiceClient {
    if (this.events === undefined)
      throw this.unavailable('EVENT_CLIENT_UNAVAILABLE');
    return this.events;
  }

  private unavailable(diagnosticCode: string): ApiHttpException {
    return new ApiHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'EVENT_SERVICE_UNAVAILABLE',
      'The waitlist is temporarily unavailable. Try again later.',
      { diagnosticCode },
    );
  }
}
