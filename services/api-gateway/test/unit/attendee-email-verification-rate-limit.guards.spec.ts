import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
  AttendeeEmailVerificationConfirmRateLimitGuard,
  AttendeeEmailVerificationResendRateLimitGuard,
} from '../../src/domains/attendees/rate-limit/guards/attendee-email-verification-rate-limit.guards';
import { AttendeeEmailVerificationRateLimitService } from '../../src/domains/attendees/rate-limit/services/attendee-email-verification-rate-limit.service';
import type { RateLimitState } from '../../src/rate-limit/ports/rate-limit.state';
import type { RateLimitDecision } from '../../src/rate-limit/types/rate-limit.types';

class DeniedRateLimitState implements RateLimitState {
  consume(): Promise<RateLimitDecision> {
    return Promise.resolve({
      allowed: false,
      limits: [],
      retryAfterSeconds: 42,
    });
  }
}

function createContext(headers: Map<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        body: { email: 'attendee@example.com' },
        ip: '203.0.113.10',
        socket: {},
      }),
      getResponse: () => ({
        setHeader: (name: string, value: string) => headers.set(name, value),
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('Attendee email-verification rate-limit guards', () => {
  it.each([
    [
      'confirm',
      'EMAIL_VERIFICATION_CONFIRM_RATE_LIMITED',
      (service: AttendeeEmailVerificationRateLimitService) =>
        new AttendeeEmailVerificationConfirmRateLimitGuard(service),
    ],
    [
      'resend',
      'EMAIL_VERIFICATION_RESEND_RATE_LIMITED',
      (service: AttendeeEmailVerificationRateLimitService) =>
        new AttendeeEmailVerificationResendRateLimitGuard(service),
    ],
  ] as const)(
    'returns the endpoint-specific public contract for denied %s requests',
    async (_, expectedCode, createGuard) => {
      const headers = new Map<string, string>();
      const service = new AttendeeEmailVerificationRateLimitService(
        new DeniedRateLimitState(),
        'a-development-secret-that-is-32-chars',
      );

      await expect(
        createGuard(service).canActivate(createContext(headers)),
      ).rejects.toMatchObject({
        response: { code: expectedCode, statusCode: 429 },
      });
      expect(headers.get('Retry-After')).toBe('42');
    },
  );
});
