import type {
  AttendeeIdentityServiceClient,
  RegisterAttendeeRequest,
  RegisterAttendeeResponse,
} from '@eventa/grpc-contracts';
import { status, type CallOptions, type Metadata } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RegisterAttendeeCommandHandler } from '../../src/domains/attendees/commands/register-attendee/register-attendee-command.handler';
import { RegisterAttendeeCommand } from '../../src/domains/attendees/commands/register-attendee/register-attendee.command';

const registrationRequest = {
  email: 'attendee@example.com',
  password: 'a-secure-password',
  username: 'event_fan',
};

function createService(
  registerAttendee: AttendeeIdentityServiceClient['registerAttendee'],
  deadlineMs = 3_000,
): RegisterAttendeeCommandHandler {
  const grpcClient = {
    getService: () => ({ registerAttendee }),
  } as unknown as ClientGrpc;
  const handler = new RegisterAttendeeCommandHandler(grpcClient, deadlineMs);
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
    const handler = createService(
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

    await expect(handler.handle(command('client-request-42'))).resolves.toEqual(
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

  it('identifies an expired Identity deadline behind the stable 503 response', async () => {
    const handler = createService(() =>
      throwError(() => ({
        code: status.DEADLINE_EXCEEDED,
        details: 'Deadline exceeded',
      })),
    );

    await expect(handler.handle(command())).rejects.toMatchObject({
      diagnosticCode: 'IDENTITY_RPC_DEADLINE_EXCEEDED',
      response: {
        code: 'REGISTRATION_UNAVAILABLE',
        message: 'Registration is temporarily unavailable. Try again later.',
        statusCode: 503,
      },
    });
  });
});
