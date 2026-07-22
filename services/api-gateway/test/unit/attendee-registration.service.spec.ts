import type {
  AttendeeIdentityServiceClient,
  RegisterAttendeeRequest,
  RegisterAttendeeResponse,
} from '@eventa/grpc-contracts';
import { status, type Metadata } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { of, throwError, type Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { AttendeeRegistrationService } from '../../src/domains/attendees/services/attendee-registration.service';

const registrationRequest = {
  email: 'attendee@example.com',
  password: 'a-secure-password',
  username: 'event_fan',
};

function createService(
  registerAttendee: AttendeeIdentityServiceClient['registerAttendee'],
): AttendeeRegistrationService {
  const grpcClient = {
    getService: () => ({ registerAttendee }),
  } as unknown as ClientGrpc;
  const service = new AttendeeRegistrationService(grpcClient);
  service.onModuleInit();
  return service;
}

describe('AttendeeRegistrationService', () => {
  it('forwards the Gateway request ID through gRPC metadata', async () => {
    let receivedMetadata: Metadata | undefined;
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
      ): Observable<RegisterAttendeeResponse> => {
        receivedMetadata = metadata;
        return of(response);
      },
    );

    await expect(
      service.register(registrationRequest, 'client-request-42'),
    ).resolves.toEqual(response);
    expect(receivedMetadata?.get('x-request-id')).toEqual([
      'client-request-42',
    ]);
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

      await expect(
        service.register(registrationRequest, 'request-42'),
      ).rejects.toMatchObject({
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

    await expect(
      service.register(registrationRequest, 'request-42'),
    ).rejects.toMatchObject({
      diagnosticCode: 'IDENTITY_RPC_UNAVAILABLE',
      response: {
        code: 'REGISTRATION_UNAVAILABLE',
        message: 'Registration is temporarily unavailable. Try again later.',
        statusCode: 503,
      },
    });
  });
});
