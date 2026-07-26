import type {
  ConfirmAttendeeEmailVerificationRequest,
  ConfirmAttendeeEmailVerificationResponse,
  ResendAttendeeEmailVerificationRequest,
  ResendAttendeeEmailVerificationResponse,
} from '@eventa/grpc-contracts';
import { Metadata, status, type CallOptions } from '@grpc/grpc-js';
import type { ClientGrpc } from '@nestjs/microservices';
import { of, throwError, type Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttendeeEmailVerificationService } from '../../src/domains/attendees/services/attendee-email-verification.service';
import type { DeadlineAwareAttendeeIdentityServiceClient } from '../../src/domains/attendees/types/attendee-identity-grpc-client.types';

function createService(
  methods: Pick<
    DeadlineAwareAttendeeIdentityServiceClient,
    'confirmAttendeeEmailVerification' | 'resendAttendeeEmailVerification'
  >,
  deadlineMs = 3_000,
): AttendeeEmailVerificationService {
  const grpcClient = {
    getService: () => methods,
  } as unknown as ClientGrpc;
  const service = new AttendeeEmailVerificationService(grpcClient, deadlineMs);
  service.onModuleInit();
  return service;
}

function unusedResend(): Observable<ResendAttendeeEmailVerificationResponse> {
  return of({ accepted: true });
}

function unusedConfirm(): Observable<ConfirmAttendeeEmailVerificationResponse> {
  return of({ emailVerified: true });
}

describe('Gateway AttendeeEmailVerificationService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards confirmation with request correlation and a deadline', async () => {
    let receivedRequest: ConfirmAttendeeEmailVerificationRequest | undefined;
    let receivedMetadata: Metadata | undefined;
    let receivedOptions: CallOptions | undefined;
    const service = createService({
      confirmAttendeeEmailVerification: (
        request,
        metadata,
        options,
      ): Observable<ConfirmAttendeeEmailVerificationResponse> => {
        receivedRequest = request;
        receivedMetadata = metadata;
        receivedOptions = options;
        return of({ emailVerified: true });
      },
      resendAttendeeEmailVerification: unusedResend,
    });
    vi.spyOn(Date, 'now').mockReturnValue(10_000);

    await expect(
      service.confirm({
        email: 'attendee@example.com',
        otp: '123456',
        requestId: 'request-42',
      }),
    ).resolves.toEqual({ emailVerified: true });
    expect(receivedRequest).toEqual({
      email: 'attendee@example.com',
      otp: '123456',
    });
    expect(receivedMetadata?.get('x-request-id')).toEqual(['request-42']);
    expect(receivedOptions).toEqual({ deadline: new Date(13_000) });
  });

  it('collapses Identity confirmation failures into one public code error', async () => {
    const service = createService({
      confirmAttendeeEmailVerification: () =>
        throwError(() => ({ code: status.FAILED_PRECONDITION })),
      resendAttendeeEmailVerification: unusedResend,
    });

    await expect(
      service.confirm({
        email: 'attendee@example.com',
        otp: '000000',
        requestId: 'request-42',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'EMAIL_VERIFICATION_INVALID',
        message: 'The verification code is invalid or has expired.',
        statusCode: 400,
      },
    });
  });

  it('preserves Identity resend cooldown in the public Retry-After header', async () => {
    const metadata = new Metadata();
    metadata.set('retry-after', '37');
    const service = createService({
      confirmAttendeeEmailVerification: unusedConfirm,
      resendAttendeeEmailVerification: () =>
        throwError(() => ({
          code: status.RESOURCE_EXHAUSTED,
          metadata,
        })),
    });

    await expect(
      service.resend({
        email: 'attendee@example.com',
        requestId: 'request-42',
      }),
    ).rejects.toMatchObject({
      headers: { 'Retry-After': '37' },
      response: {
        code: 'EMAIL_VERIFICATION_RESEND_RATE_LIMITED',
        statusCode: 429,
      },
    });
  });

  it('returns the generic accepted resend response without account state', async () => {
    let receivedRequest: ResendAttendeeEmailVerificationRequest | undefined;
    const service = createService({
      confirmAttendeeEmailVerification: unusedConfirm,
      resendAttendeeEmailVerification: (
        request,
      ): Observable<ResendAttendeeEmailVerificationResponse> => {
        receivedRequest = request;
        return of({ accepted: true });
      },
    });

    await expect(
      service.resend({
        email: 'unknown@example.com',
        requestId: 'request-42',
      }),
    ).resolves.toEqual({ accepted: true });
    expect(receivedRequest).toEqual({ email: 'unknown@example.com' });
  });
});
