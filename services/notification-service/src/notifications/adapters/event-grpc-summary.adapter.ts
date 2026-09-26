import {
  EVENT_SERVICE_NAME,
  type EventServiceClient,
  type GetEventSummaryResponse,
} from '@eventa/grpc-contracts';
import { Metadata, status } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import type { OnModuleInit } from '@nestjs/common';
import { firstValueFrom, type Observable } from 'rxjs';

import { EventSummaryNotFoundError } from '../errors/cancellation-email.errors';
import type {
  EventSummary,
  EventSummaryProvider,
} from '../ports/event-summary.provider';

interface DeadlineAwareGetEventSummary {
  (
    request: { eventId: string },
    metadata: Metadata,
    options: { deadline: Date },
  ): Observable<GetEventSummaryResponse>;
}

export class EventGrpcSummaryAdapter
  implements EventSummaryProvider, OnModuleInit
{
  private client: EventServiceClient | undefined;

  constructor(
    private readonly grpcClient: ClientGrpc,
    private readonly deadlineMs: number,
  ) {}

  onModuleInit(): void {
    this.client =
      this.grpcClient.getService<EventServiceClient>(EVENT_SERVICE_NAME);
  }

  async getSummary(eventId: string): Promise<EventSummary> {
    const client = this.client;

    if (client === undefined) {
      throw new EventSummaryNotFoundError();
    }

    const getEventSummary = client.getEventSummary.bind(
      client,
    ) as unknown as DeadlineAwareGetEventSummary;

    try {
      const response = await firstValueFrom(
        getEventSummary({ eventId }, EventGrpcSummaryAdapter.metadata(), {
          deadline: new Date(Date.now() + this.deadlineMs),
        }),
      );

      return {
        eventId: response.eventId,
        ...(response.startsAt === undefined
          ? {}
          : { startsAt: response.startsAt }),
        ...(response.timeZone === undefined
          ? {}
          : { timeZone: response.timeZone }),
        title: response.title,
        ...(response.venue === undefined
          ? {}
          : {
              venueCity: response.venue.city,
              venueName: response.venue.name,
            }),
      };
    } catch (error: unknown) {
      if (isNotFound(error)) {
        throw new EventSummaryNotFoundError();
      }

      throw error;
    }
  }

  private static metadata(): Metadata {
    const metadata = new Metadata();
    metadata.set('x-request-id', crypto.randomUUID());
    return metadata;
  }
}

function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  return (error as { code?: number }).code === status.NOT_FOUND;
}
