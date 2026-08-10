import {
  EventStatus,
  type Event,
  type PublishEventRequest,
  type PublishEventResponse,
} from '@eventa/grpc-contracts';
import { status, type CallOptions, type Metadata } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminEventService } from '../../src/domains/events/services/admin-event.service';
import type { DeadlineAwareEventServiceClient } from '../../src/domains/events/types/event-grpc-client.types';

const publishedEvent: Event = {
  category: 'Community',
  createdAt: '2026-08-10T10:00:00.000Z',
  createdByAdminId: '1b878b2e-c0b8-44f6-b890-b15f237bb40e',
  description: 'A published event.',
  endsAt: '2026-08-12T12:00:00.000Z',
  eventId: '53f24606-184d-4c2f-bd68-9e27a9e034e9',
  media: [],
  publishedAt: '2026-08-10T10:05:00.000Z',
  startsAt: '2026-08-12T10:00:00.000Z',
  status: EventStatus.EVENT_STATUS_PUBLISHED,
  timeZone: 'Africa/Lagos',
  title: 'Published event',
  updatedAt: '2026-08-10T10:05:00.000Z',
  venue: {
    addressLine1: '1 Marina Road',
    city: 'Lagos',
    countryCode: 'NG',
    name: 'Eventa Hall',
  },
  version: 4,
};

function createService(
  publishEvent: DeadlineAwareEventServiceClient['publishEvent'],
  deadlineMs = 3_000,
): AdminEventService {
  const grpcClient = {
    getService: () => ({ publishEvent }),
  } as unknown as ClientGrpc;
  const service = new AdminEventService(grpcClient, deadlineMs);
  service.onModuleInit();
  return service;
}

describe('AdminEventService publication', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards publication identity, correlation, and deadline', async () => {
    let receivedRequest: PublishEventRequest | undefined;
    let receivedMetadata: Metadata | undefined;
    let receivedOptions: CallOptions | undefined;
    const service = createService(
      (
        request: PublishEventRequest,
        metadata?: Metadata,
        options?: CallOptions,
      ): Observable<PublishEventResponse> => {
        receivedRequest = request;
        receivedMetadata = metadata;
        receivedOptions = options;
        return of({ event: publishedEvent });
      },
    );
    vi.spyOn(Date, 'now').mockReturnValue(10_000);

    await expect(
      service.publish(
        publishedEvent.createdByAdminId,
        publishedEvent.eventId,
        { expectedVersion: 3 },
        'publication-request',
      ),
    ).resolves.toMatchObject({
      eventId: publishedEvent.eventId,
      publishedAt: publishedEvent.publishedAt,
      status: 'published',
      version: 4,
    });
    expect(receivedRequest).toEqual({
      adminId: publishedEvent.createdByAdminId,
      eventId: publishedEvent.eventId,
      expectedVersion: 3,
    });
    expect(receivedMetadata?.get('x-request-id')).toEqual([
      'publication-request',
    ]);
    expect(receivedOptions).toEqual({ deadline: new Date(13_000) });
  });

  it('translates incomplete publication into the public 422 contract', async () => {
    const service = createService(() =>
      throwError(() => ({ code: status.FAILED_PRECONDITION })),
    );

    await expect(
      service.publish(
        publishedEvent.createdByAdminId,
        publishedEvent.eventId,
        { expectedVersion: 3 },
        'publication-request',
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'EVENT_PUBLICATION_INCOMPLETE',
        message:
          'Complete the event details, venue, and cover image before publishing.',
        statusCode: 422,
      },
      status: 422,
    });
  });
});
