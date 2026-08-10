import {
  EventMediaSlot,
  type GetPublishedEventRequest,
  type GetPublishedEventResponse,
  type PublishedEvent,
} from '@eventa/grpc-contracts';
import { status, type CallOptions, type Metadata } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PublishedEventService } from '../../src/domains/events/services/published-event.service';
import type { DeadlineAwareEventServiceClient } from '../../src/domains/events/types/event-grpc-client.types';

const publishedEvent: PublishedEvent = {
  category: 'Community',
  description: 'An authoritative public event.',
  endsAt: '2026-08-12T12:00:00.000Z',
  eventId: '53f24606-184d-4c2f-bd68-9e27a9e034e9',
  media: [
    {
      contentType: 'image/jpeg',
      height: 600,
      mediaId: 'c0caa9fc-6f69-4118-ad7f-110d872da987',
      sizeBytes: 2048,
      slot: EventMediaSlot.EVENT_MEDIA_SLOT_COVER,
      url: 'https://media.example.test/events/cover.jpg',
      width: 800,
    },
  ],
  publishedAt: '2026-08-10T10:05:00.000Z',
  startsAt: '2026-08-12T10:00:00.000Z',
  timeZone: 'Africa/Lagos',
  title: 'Published event',
  venue: {
    addressLine1: '1 Marina Road',
    city: 'Lagos',
    countryCode: 'NG',
    name: 'Eventa Hall',
  },
  version: 4,
};

function createService(
  getPublishedEvent: DeadlineAwareEventServiceClient['getPublishedEvent'],
  deadlineMs = 3_000,
): PublishedEventService {
  const grpcClient = {
    getService: () => ({ getPublishedEvent }),
  } as unknown as ClientGrpc;
  const service = new PublishedEventService(grpcClient, deadlineMs);
  service.onModuleInit();
  return service;
}

describe('PublishedEventService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards correlation and returns the public event shape', async () => {
    let receivedRequest: GetPublishedEventRequest | undefined;
    let receivedMetadata: Metadata | undefined;
    let receivedOptions: CallOptions | undefined;
    const service = createService(
      (
        request: GetPublishedEventRequest,
        metadata?: Metadata,
        options?: CallOptions,
      ): Observable<GetPublishedEventResponse> => {
        receivedRequest = request;
        receivedMetadata = metadata;
        receivedOptions = options;
        return of({ event: publishedEvent });
      },
    );
    vi.spyOn(Date, 'now').mockReturnValue(10_000);

    await expect(
      service.getById(publishedEvent.eventId, 'published-read-request'),
    ).resolves.toEqual({
      ...publishedEvent,
      media: [
        {
          ...publishedEvent.media[0],
          contentType: 'image/jpeg',
          slot: 'cover',
        },
      ],
    });
    expect(receivedRequest).toEqual({ eventId: publishedEvent.eventId });
    expect(receivedMetadata?.get('x-request-id')).toEqual([
      'published-read-request',
    ]);
    expect(receivedOptions).toEqual({ deadline: new Date(13_000) });
  });

  it('hides draft and missing state behind the public 404 contract', async () => {
    const service = createService(() =>
      throwError(() => ({ code: status.NOT_FOUND })),
    );

    await expect(
      service.getById(publishedEvent.eventId, 'published-read-request'),
    ).rejects.toMatchObject({
      response: {
        code: 'EVENT_NOT_FOUND',
        message: 'Event was not found.',
        statusCode: 404,
      },
      status: 404,
    });
  });

  it.each([
    [status.DEADLINE_EXCEEDED, 'EVENT_READ_RPC_DEADLINE_EXCEEDED'],
    [status.UNAVAILABLE, 'EVENT_READ_RPC_UNAVAILABLE'],
  ])(
    'hides dependency status %s behind the public 503 contract',
    async (code, diagnosticCode) => {
      const service = createService(() => throwError(() => ({ code })));

      await expect(
        service.getById(publishedEvent.eventId, 'published-read-request'),
      ).rejects.toMatchObject({
        diagnosticCode,
        response: {
          code: 'EVENT_SERVICE_UNAVAILABLE',
          statusCode: 503,
        },
        status: 503,
      });
    },
  );
});
