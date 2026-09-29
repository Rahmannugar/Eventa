import type {
  GetAttendeeInterestsResponse,
  SetAttendeeInterestsRequest,
  SetAttendeeInterestsResponse,
} from '@eventa/grpc-contracts';
import { status, type CallOptions, type Metadata } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { of, throwError, type Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { ApiHttpException } from '../../src/http/errors/api-http.exception';
import type { SetAttendeeInterestsDto } from '../../src/domains/discovery/dto/discovery-interests.dto';
import { DiscoveryInterestsService } from '../../src/domains/discovery/services/discovery-interests.service';
import type { DeadlineAwareDiscoveryClient } from '../../src/domains/discovery/types/discovery-grpc-client.types';

const attendeeId = '1d29185a-ba65-491f-8bd8-1cbc54b85630';
const saved: SetAttendeeInterestsDto = { interests: ['music', 'jazz'] };

function createService(
  methods: Partial<DeadlineAwareDiscoveryClient>,
  deadlineMs = 3_000,
): DiscoveryInterestsService {
  const grpcClient = {
    getService: () => methods,
  } as unknown as ClientGrpc;
  const service = new DiscoveryInterestsService(grpcClient, deadlineMs);
  service.onModuleInit();
  return service;
}

describe('DiscoveryInterestsService', () => {
  it('forwards the attendee id, interests, and correlation id, and returns the saved shape', async () => {
    let receivedRequest: SetAttendeeInterestsRequest | undefined;
    let receivedMetadata: Metadata | undefined;
    let receivedOptions: CallOptions | undefined;

    const service = createService({
      setAttendeeInterests: (
        request: SetAttendeeInterestsRequest,
        metadata?: Metadata,
        options?: CallOptions,
      ): Observable<SetAttendeeInterestsResponse> => {
        receivedRequest = request;
        receivedMetadata = metadata;
        receivedOptions = options;
        return of({
          attendeeId,
          interests: ['music', 'jazz'],
          updatedAt: '2026-09-29T00:05:33Z',
        });
      },
    });

    await expect(service.set(attendeeId, saved, 'request-123')).resolves.toEqual({
      interests: ['music', 'jazz'],
      updatedAt: '2026-09-29T00:05:33Z',
    });
    expect(receivedRequest).toEqual({ attendeeId, interests: ['music', 'jazz'] });
    expect(receivedMetadata?.get('x-request-id')).toEqual(['request-123']);
    expect(receivedOptions?.deadline).toBeInstanceOf(Date);
  });

  it('returns the stored list with no update time when nothing has been saved', async () => {
    const service = createService({
      getAttendeeInterests: (): Observable<GetAttendeeInterestsResponse> =>
        of({ attendeeId, interests: [], updatedAt: '' }),
    });

    await expect(service.get(attendeeId, 'request-123')).resolves.toEqual({
      interests: [],
      updatedAt: undefined,
    });
  });

  it('refuses to return interests recorded for a different attendee', async () => {
    const service = createService({
      getAttendeeInterests: (): Observable<GetAttendeeInterestsResponse> =>
        of({
          attendeeId: '2d3a295b-0b76-4e00-a0cf-2dc65cb96741',
          interests: ['music'],
          updatedAt: '',
        }),
    });

    await expect(service.get(attendeeId, 'request-123')).rejects.toMatchObject({
      diagnosticCode: 'DISCOVERY_INTERESTS_RESPONSE_INVALID',
      response: {
        code: 'DISCOVERY_SERVICE_UNAVAILABLE',
        statusCode: 503,
      },
    });
  });

  it('reports a request Discovery rejected as invalid', async () => {
    const service = createService({
      setAttendeeInterests: () =>
        throwError(() => ({ code: status.INVALID_ARGUMENT })),
    });

    await expect(service.set(attendeeId, saved, 'request-123')).rejects.toMatchObject({
      response: {
        code: 'INTERESTS_INVALID',
        statusCode: 400,
      },
    });
  });

  it('reports a missed deadline as an unavailable answer', async () => {
    const service = createService({
      getAttendeeInterests: () =>
        throwError(() => ({ code: status.DEADLINE_EXCEEDED })),
    });

    await expect(service.get(attendeeId, 'request-123')).rejects.toMatchObject({
      diagnosticCode: 'DISCOVERY_INTERESTS_RPC_DEADLINE_EXCEEDED',
      response: {
        code: 'DISCOVERY_SERVICE_UNAVAILABLE',
        statusCode: 503,
      },
    });
  });

  it('does not claim an exception was produced by Discovery when it never reached it', async () => {
    const service = createService({});

    await expect(service.get(attendeeId, 'request-123')).rejects.toBeInstanceOf(
      ApiHttpException,
    );
  });
});
