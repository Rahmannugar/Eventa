import type { AttendeeRegistrar } from '../../src/attendees/types/attendee-registration.types';
import { AttendeeIdentityController } from '../../src/attendees/controllers/attendee-identity.controller';
import type { AttendeeEmailVerificationService } from '../../src/attendees/services/attendee-email-verification.service';
import type { AttendeeLoginService } from '../../src/attendees/services/attendee-login.service';
import type { AttendeeAccountService } from '../../src/attendees/services/attendee-account.service';
import type { AttendeeSessionService } from '../../src/attendees/services/attendee-session.service';
import {
  EmailVerificationOtpInvalidError,
  EmailVerificationResendRateLimitedError,
} from '../../src/attendees/errors/attendee-email-verification.errors';
import {
  AttendeeAccountDeletedError,
  AttendeeAccountSuspendedError,
} from '../../src/attendees/errors/attendee-login.errors';
import { Metadata, status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

class RecordingEmailVerification {
  confirmResult: Error | { emailVerified: true } = { emailVerified: true };
  resendResult: Error | { accepted: true } = { accepted: true };

  confirm(): Promise<{ emailVerified: true }> {
    return this.confirmResult instanceof Error
      ? Promise.reject(this.confirmResult)
      : Promise.resolve(this.confirmResult);
  }

  resend(): Promise<{ accepted: true }> {
    return this.resendResult instanceof Error
      ? Promise.reject(this.resendResult)
      : Promise.resolve(this.resendResult);
  }
}

function createController(
  verification: RecordingEmailVerification,
  login: Pick<AttendeeLoginService, 'login'> = {
    login: () => {
      throw new Error('Login is not exercised by this test');
    },
  },
): AttendeeIdentityController {
  const registrar: AttendeeRegistrar = {
    register: () => {
      throw new Error('Registration is not exercised by this test');
    },
  };

  return new AttendeeIdentityController(
    registrar,
    verification as unknown as AttendeeEmailVerificationService,
    login as AttendeeLoginService,
    {} as AttendeeSessionService,
    {} as AttendeeAccountService,
  );
}

describe('AttendeeIdentityController email verification', () => {
  it('forwards successful confirmation through the generated RPC handler', async () => {
    const controller = createController(new RecordingEmailVerification());

    await expect(
      firstValueFrom(
        controller.confirmAttendeeEmailVerification({
          email: 'attendee@example.com',
          otp: '123456',
        }),
      ),
    ).resolves.toEqual({ emailVerified: true });
  });

  it('maps every invalid OTP domain result to FAILED_PRECONDITION', async () => {
    const verification = new RecordingEmailVerification();
    verification.confirmResult = new EmailVerificationOtpInvalidError();
    const controller = createController(verification);

    const rejection = firstValueFrom(
      controller.confirmAttendeeEmailVerification({
        email: 'attendee@example.com',
        otp: '123456',
      }),
    );

    await expect(rejection).rejects.toBeInstanceOf(RpcException);
    await expect(rejection).rejects.toMatchObject({
      error: {
        code: status.FAILED_PRECONDITION,
        message: 'EMAIL_VERIFICATION_OTP_INVALID_OR_EXPIRED',
      },
    });
  });

  it('returns cooldown duration as safe gRPC metadata', async () => {
    const verification = new RecordingEmailVerification();
    verification.resendResult = new EmailVerificationResendRateLimitedError(37);
    const controller = createController(verification);

    const rejection = firstValueFrom(
      controller.resendAttendeeEmailVerification({
        email: 'attendee@example.com',
      }),
    );

    await expect(rejection).rejects.toBeInstanceOf(RpcException);
    await expect(rejection).rejects.toSatisfy((error: RpcException) => {
      const rpcError = error.getError();

      if (typeof rpcError !== 'object' || rpcError === null) {
        return false;
      }

      const metadata: unknown = Reflect.get(rpcError, 'metadata');

      return (
        Reflect.get(rpcError, 'code') === status.RESOURCE_EXHAUSTED &&
        metadata instanceof Metadata &&
        metadata.get('retry-after')[0] === '37'
      );
    });
  });
});

describe('AttendeeIdentityController login lifecycle outcomes', () => {
  it.each([
    [new AttendeeAccountDeletedError(), 'ATTENDEE_ACCOUNT_DELETED'],
    [new AttendeeAccountSuspendedError(), 'ATTENDEE_ACCOUNT_SUSPENDED'],
  ])('returns FAILED_PRECONDITION for %s', async (error, message) => {
    const controller = createController(new RecordingEmailVerification(), {
      login: () => Promise.reject(error),
    });

    await expect(
      firstValueFrom(
        controller.loginAttendee({
          email: 'attendee@example.com',
          password: 'correct-password',
        }),
      ),
    ).rejects.toMatchObject({
      error: { code: status.FAILED_PRECONDITION, message },
    });
  });
});
