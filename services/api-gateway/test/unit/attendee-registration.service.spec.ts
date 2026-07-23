import type {
  RegisterAttendeeRequest,
  RegisterAttendeeResponse,
} from '@eventa/grpc-contracts';
import { status, type CallOptions, type Metadata } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AttendeeRegistrationService,
  type RegisterAttendeeInput,
} from '../../src/domains/attendees/services/attendee-registration.service';
import type { DeadlineAwareAttendeeIdentityServiceClient } from '../../src/domains/attendees/types/attendee-identity-grpc-client.types';

const registrationRequest = {
  email: 'attendee@example.com',
  password: 'a-secure-password',
  username: 'event_fan',
};

function createService(
  registerAttendee: DeadlineAwareAttendeeIdentityServiceClient['registerAttendee'],
  deadlineMs = 3_000,
): AttendeeRegistrationService {
  const grpcClient = {
    getService: () => ({ registerAttendee }),
  } as unknown as ClientGrpc;
  const service = new AttendeeRegistrationService(grpcClient, deadlineMs);
  service.onModuleInit();
  return service;
}

function input(requestId = 'request-42'): RegisterAttendeeInput {
  return { ...registrationRequest, requestId };
}

describe('AttendeeRegistrationService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards the request ID and a bounded deadline through gRPC', async () => {
    let receivedMetadata: Metadata | undefined;
    let receivedOptions: CallOptions | undefined;
    const response: RegisterAttendeeResponse = {
      attendeeId: '85aa26b8-253f-42a0-9a99-f83e1bb2d871',
      email: registrationRequest.email,
      emailVerified: false,
      username: registrationRequest.username,
    };
    const service = createService(
      (
        _request: RegisterAttendeeRequest,
        metadata?: Metadata,
        options?: CallOptions,
      ): Observable<RegisterAttendeeResponse> => {
        receivedMetadata = metadata;
        receivedOptions = options;
        return of(response);
      },
    );
    vi.spyOn(Date, 'now').mockReturnValue(10_000);

    await expect(service.register(input('client-request-42'))).resolves.toEqual(
      response,
    );
    expect(receivedMetadata?.get('x-request-id')).toEqual([
      'client-request-42',
    ]);
    expect(receivedOptions).toEqual({ deadline: new Date(13_000) });
  });

  it.each([
    [
      'EMAIL_ALREADY_REGISTERED',
      'EMAIL_ALREADY_REGISTERED',
      'An attendee account already uses this email address.',
    ],
    [
      'USERNAME_UNAVAILABLE',
      'USERNAME_UNAVAILABLE',
      'Choose a different username.',
    ],
  ])(
    'translates Identity conflict %s into the public 409 contract',
    async (details, expectedCode, expectedMessage) => {
      const service = createService(() =>
        throwError(() => ({ code: status.ALREADY_EXISTS, details })),
      );

      await expect(service.register(input())).rejects.toMatchObject({
        response: {
          code: expectedCode,
          message: expectedMessage,
          statusCode: 409,
        },
        status: 409,
      });
    },
  );

  it('hides internal Identity failures behind a stable 503 response', async () => {
    const service = createService(() =>
      throwError(() => ({ code: status.UNAVAILABLE, details: 'connection' })),
    );

    await expect(service.register(input())).rejects.toMatchObject({
      diagnosticCode: 'IDENTITY_RPC_UNAVAILABLE',
      response: {
        code: 'REGISTRATION_UNAVAILABLE',
        message: 'Registration is temporarily unavailable. Try again later.',
        statusCode: 503,
      },
    });
  });

  it('identifies an expired Identity deadline behind the stable 503 response', async () => {
    const service = createService(() =>
      throwError(() => ({
        code: status.DEADLINE_EXCEEDED,
        details: 'Deadline exceeded',
      })),
    );

    await expect(service.register(input())).rejects.toMatchObject({
      diagnosticCode: 'IDENTITY_RPC_DEADLINE_EXCEEDED',
      response: {
        code: 'REGISTRATION_UNAVAILABLE',
        message: 'Registration is temporarily unavailable. Try again later.',
        statusCode: 503,
      },
    });
  });
});
