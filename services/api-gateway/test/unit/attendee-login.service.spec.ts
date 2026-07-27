import type {
  LoginAttendeeRequest,
  LoginAttendeeResponse,
} from '@eventa/grpc-contracts';
import { status, type CallOptions, type Metadata } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { of, throwError, type Observable } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import {
  AttendeeLoginService,
  type LoginAttendeeInput,
} from '../../src/domains/attendees/services/attendee-login.service';
import type { DeadlineAwareAttendeeIdentityServiceClient } from '../../src/domains/attendees/types/attendee-identity-grpc-client.types';

const RESPONSE: LoginAttendeeResponse = {
  attendeeId: 'attendee-1',
  email: 'attendee@example.com',
  emailVerified: true,
  sessionExpiresAt: '2026-08-03T12:00:00.000Z',
  sessionToken: 'opaque-token',
  status: 'active',
  username: 'eventfan',
};

function createService(
  loginAttendee: DeadlineAwareAttendeeIdentityServiceClient['loginAttendee'],
): AttendeeLoginService {
  const client = {
    getService: () => ({ loginAttendee }),
  } as unknown as ClientGrpc;
  const service = new AttendeeLoginService(client, 3_000);
  service.onModuleInit();
  return service;
}

function input(): LoginAttendeeInput {
  return {
    email: 'attendee@example.com',
    password: 'correct-password',
    requestId: 'request-42',
  };
}

describe('Gateway AttendeeLoginService', () => {
  it('forwards correlation and a bounded Identity deadline', async () => {
    let metadata: Metadata | undefined;
    let options: CallOptions | undefined;
    const service = createService(
      (
        _request: LoginAttendeeRequest,
        receivedMetadata?: Metadata,
        receivedOptions?: CallOptions,
      ): Observable<LoginAttendeeResponse> => {
        metadata = receivedMetadata;
        options = receivedOptions;
        return of(RESPONSE);
      },
    );
    vi.spyOn(Date, 'now').mockReturnValue(10_000);

    await expect(service.login(input())).resolves.toEqual(RESPONSE);
    expect(metadata?.get('x-request-id')).toEqual(['request-42']);
    expect(options).toEqual({ deadline: new Date(13_000) });
  });

  it.each([
    [status.UNAUTHENTICATED, undefined, 401, 'INVALID_CREDENTIALS'],
    [
      status.FAILED_PRECONDITION,
      'ATTENDEE_EMAIL_VERIFICATION_REQUIRED',
      403,
      'EMAIL_VERIFICATION_REQUIRED',
    ],
    [
      status.FAILED_PRECONDITION,
      'ATTENDEE_ACCOUNT_DELETED',
      403,
      'ACCOUNT_DELETED',
    ],
    [
      status.FAILED_PRECONDITION,
      'ATTENDEE_ACCOUNT_SUSPENDED',
      403,
      'ACCOUNT_SUSPENDED',
    ],
    [status.INVALID_ARGUMENT, undefined, 422, 'VALIDATION_FAILED'],
    [status.UNAVAILABLE, undefined, 503, 'AUTHENTICATION_UNAVAILABLE'],
  ])(
    'translates Identity status %s and detail %s to HTTP %s',
    async (grpcStatus, details, httpStatus, code) => {
      const service = createService(() =>
        throwError(() => ({ code: grpcStatus, details })),
      );

      await expect(service.login(input())).rejects.toMatchObject({
        response: { code, statusCode: httpStatus },
        status: httpStatus,
      });
    },
  );
});
