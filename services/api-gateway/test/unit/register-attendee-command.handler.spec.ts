import type {
  AttendeeIdentityServiceClient,
  RegisterAttendeeRequest,
  RegisterAttendeeResponse,
} from '@eventa/grpc-contracts';
import { status, type Metadata } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { of, throwError, type Observable } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { RegisterAttendeeCommandHandler } from '../../src/domains/attendees/commands/register-attendee/register-attendee-command.handler';
import { RegisterAttendeeCommand } from '../../src/domains/attendees/commands/register-attendee/register-attendee.command';

const registrationRequest = {
  email: 'attendee@example.com',
  password: 'a-secure-password',
  username: 'event_fan',
};

function createService(
  registerAttendee: AttendeeIdentityServiceClient['registerAttendee'],
): RegisterAttendeeCommandHandler {
  const grpcClient = {
    getService: () => ({ registerAttendee }),
  } as unknown as ClientGrpc;
  const handler = new RegisterAttendeeCommandHandler(grpcClient);
  handler.onModuleInit();
  return handler;
}

function command(requestId = 'request-42'): RegisterAttendeeCommand {
  return new RegisterAttendeeCommand(
    registrationRequest.email,
    registrationRequest.password,
    registrationRequest.username,
    requestId,
  );
}

describe('RegisterAttendeeCommandHandler', () => {
  it('forwards the Gateway request ID through gRPC metadata', async () => {
    let receivedMetadata: Metadata | undefined;
    const response: RegisterAttendeeResponse = {
      attendeeId: '85aa26b8-253f-42a0-9a99-f83e1bb2d871',
      email: registrationRequest.email,
      emailVerified: false,
      username: registrationRequest.username,
    };
    const handler = createService(
      (
        _request: RegisterAttendeeRequest,
        metadata?: Metadata,
      ): Observable<RegisterAttendeeResponse> => {
        receivedMetadata = metadata;
        return of(response);
      },
    );

    await expect(handler.handle(command('client-request-42'))).resolves.toEqual(
      response,
    );
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
      const handler = createService(() =>
        throwError(() => ({ code: status.ALREADY_EXISTS, details })),
      );

      await expect(handler.handle(command())).rejects.toMatchObject({
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
    const handler = createService(() =>
      throwError(() => ({ code: status.UNAVAILABLE, details: 'connection' })),
    );

    await expect(handler.handle(command())).rejects.toMatchObject({
      diagnosticCode: 'IDENTITY_RPC_UNAVAILABLE',
      response: {
        code: 'REGISTRATION_UNAVAILABLE',
        message: 'Registration is temporarily unavailable. Try again later.',
        statusCode: 503,
      },
    });
  });
});
