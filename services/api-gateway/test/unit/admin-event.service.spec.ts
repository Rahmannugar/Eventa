import {
  AdminEventSort,
  type CreateDraftEventRequest,
  type CreateDraftEventResponse,
  EventStatus,
  type Event,
  type ListAdminEventsRequest,
  type ListAdminEventsResponse,
  type PublishEventRequest,
  type PublishEventResponse,
  type RetireDraftEventRequest,
  type RetireDraftEventResponse,
} from '@eventa/grpc-contracts';
import { status, type CallOptions, type Metadata } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminEventService } from '../../src/domains/events/services/admin-event.service';
import type { DeadlineAwareEventServiceClient } from '../../src/domains/events/types/event-grpc-client.types';

const publishedEvent: Event = {
  categories: ['Community'],
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
    addressLineOne: '1 Marina Road',
    city: 'Lagos',
    countryCode: 'NG',
    name: 'Eventa Hall',
  },
  version: 4,
};

const draftEvent: Event = {
  categories: [],
  createdAt: '2026-08-16T06:19:02.000Z',
  createdByAdminId: '1b878b2e-c0b8-44f6-b890-b15f237bb40e',
  eventId: '6a6cbaf7-7720-4ab6-9419-f8189b9d173c',
  media: [],
  status: EventStatus.EVENT_STATUS_DRAFT,
  title: 'Lagos Design Week',
  updatedAt: '2026-08-16T06:19:02.000Z',
  venue: undefined,
  version: 1,
};

const createInput = {
  categories: ['Community'],
  description: 'A complete event.',
  endsAt: '2026-08-20T12:00:00.000Z',
  startsAt: '2026-08-20T10:00:00.000Z',
  timeZone: 'Africa/Lagos',
  title: draftEvent.title,
  venue: {
    addressLine1: '1 Marina Road',
    addressLineOne: '1 Marina Road',
    city: 'Lagos',
    countryCode: 'NG',
    name: 'Eventa Hall',
  },
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

function createDraftService(
  createDraftEvent: DeadlineAwareEventServiceClient['createDraftEvent'],
  deadlineMs = 3_000,
): AdminEventService {
  const grpcClient = {
    getService: () => ({ createDraftEvent }),
  } as unknown as ClientGrpc;
  const service = new AdminEventService(grpcClient, deadlineMs);
  service.onModuleInit();
  return service;
}

function createListService(
  listAdminEvents: DeadlineAwareEventServiceClient['listAdminEvents'],
  deadlineMs = 3_000,
): AdminEventService {
  const grpcClient = {
    getService: () => ({ listAdminEvents }),
  } as unknown as ClientGrpc;
  const service = new AdminEventService(grpcClient, deadlineMs);
  service.onModuleInit();
  return service;
}

function createRetireService(
  retireDraftEvent: DeadlineAwareEventServiceClient['retireDraftEvent'],
  deadlineMs = 3_000,
): AdminEventService {
  const grpcClient = {
    getService: () => ({ retireDraftEvent }),
  } as unknown as ClientGrpc;
  const service = new AdminEventService(grpcClient, deadlineMs);
  service.onModuleInit();
  return service;
}

describe('AdminEventService draft creation', () => {
  it('accepts an omitted empty media list', async () => {
    let receivedRequest: CreateDraftEventRequest | undefined;
    const wireEvent = {
      ...draftEvent,
      media: undefined,
    } as unknown as Event;
    const createDraftEvent = (
      request: CreateDraftEventRequest,
    ): Observable<CreateDraftEventResponse> => {
      receivedRequest = request;
      return of({ event: wireEvent });
    };
    const service = createDraftService(createDraftEvent);

    await expect(
      service.createDraft(
        draftEvent.createdByAdminId,
        createInput,
        'draft-request',
      ),
    ).resolves.toMatchObject({
      eventId: draftEvent.eventId,
      media: [],
      status: 'draft',
      version: 1,
    });
    expect(receivedRequest?.venue).toMatchObject({
      addressLine1: '1 Marina Road',
      addressLineOne: '1 Marina Road',
    });
  });

  it('preserves invalid response diagnostics', async () => {
    const invalidEvent = { ...draftEvent, version: 0 };
    const createDraftEvent = (): Observable<CreateDraftEventResponse> =>
      of({ event: invalidEvent });
    const service = createDraftService(createDraftEvent);

    await expect(
      service.createDraft(
        draftEvent.createdByAdminId,
        createInput,
        'draft-request',
      ),
    ).rejects.toMatchObject({
      diagnosticCode: 'EVENT_RESPONSE_INVALID',
    });
  });
});

describe('AdminEventService catalogue', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards pagination and maps event summaries', async () => {
    let receivedRequest: ListAdminEventsRequest | undefined;
    let receivedMetadata: Metadata | undefined;
    let receivedOptions: CallOptions | undefined;
    const service = createListService(
      (request, metadata, options): Observable<ListAdminEventsResponse> => {
        receivedRequest = request;
        receivedMetadata = metadata;
        receivedOptions = options;
        return of({
          events: [
            {
              categories: ['Outdoors', 'Sports'],
              eventId: draftEvent.eventId,
              startsAt: createInput.startsAt,
              status: EventStatus.EVENT_STATUS_DRAFT,
              timeZone: createInput.timeZone,
              title: draftEvent.title,
              updatedAt: draftEvent.updatedAt,
              venue: createInput.venue,
            },
          ],
          nextPageToken: 'next-page',
        });
      },
    );
    vi.spyOn(Date, 'now').mockReturnValue(10_000);

    await expect(
      service.list(
        {
          limit: 20,
          cursor: 'page-token',
          search: 'lagos',
          countryCode: 'NG',
          regionCode: 'LA',
          sort: 'event_date_asc',
        },
        'list-request',
      ),
    ).resolves.toEqual({
      events: [
        expect.objectContaining({
          categories: ['Outdoors', 'Sports'],
          eventId: draftEvent.eventId,
          status: 'draft',
        }),
      ],
      nextCursor: 'next-page',
    });
    expect(receivedRequest).toEqual({
      pageSize: 20,
      pageToken: 'page-token',
      search: 'lagos',
      countryCode: 'NG',
      regionCode: 'LA',
      sort: AdminEventSort.ADMIN_EVENT_SORT_EVENT_DATE_ASC,
    });
    expect(receivedMetadata?.get('x-request-id')).toEqual(['list-request']);
    expect(receivedOptions).toEqual({ deadline: new Date(13_000) });
  });
});

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

describe('AdminEventService retirement', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards retirement identity, correlation, and deadline', async () => {
    let receivedRequest: RetireDraftEventRequest | undefined;
    let receivedMetadata: Metadata | undefined;
    let receivedOptions: CallOptions | undefined;
    const service = createRetireService(
      (
        request: RetireDraftEventRequest,
        metadata?: Metadata,
        options?: CallOptions,
      ): Observable<RetireDraftEventResponse> => {
        receivedRequest = request;
        receivedMetadata = metadata;
        receivedOptions = options;
        return of({ eventVersion: 2 });
      },
    );
    vi.spyOn(Date, 'now').mockReturnValue(10_000);

    await expect(
      service.retire(
        draftEvent.createdByAdminId,
        draftEvent.eventId,
        1,
        'retirement-request',
      ),
    ).resolves.toEqual({ eventVersion: 2 });
    expect(receivedRequest).toEqual({
      adminId: draftEvent.createdByAdminId,
      eventId: draftEvent.eventId,
      expectedVersion: 1,
    });
    expect(receivedMetadata?.get('x-request-id')).toEqual([
      'retirement-request',
    ]);
    expect(receivedOptions).toEqual({ deadline: new Date(13_000) });
  });

  it('rejects published retirement through the public contract', async () => {
    const service = createRetireService(() =>
      throwError(() => ({ code: status.FAILED_PRECONDITION })),
    );

    await expect(
      service.retire(
        publishedEvent.createdByAdminId,
        publishedEvent.eventId,
        publishedEvent.version,
        'retirement-request',
      ),
    ).rejects.toMatchObject({
      response: {
        code: 'EVENT_RETIREMENT_NOT_ALLOWED',
        message: 'Published events cannot be removed.',
        statusCode: 422,
      },
      status: 422,
    });
  });
});
