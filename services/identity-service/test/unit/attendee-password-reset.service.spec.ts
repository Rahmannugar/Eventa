import { describe, expect, it } from 'vitest';

import type { PasswordHasher } from '../../src/security/types/password-hasher.types';
import type { PasswordResetCodeState } from '../../src/security/ports/password-reset-code.state';
import type { AttendeeAuthJobPublisher } from '../../src/attendees/ports/attendee-auth-job.publisher';
import { AttendeePasswordResetService } from '../../src/attendees/services/attendee-password-reset.service';
import type { AttendeeSessionService } from '../../src/attendees/services/attendee-session.service';
import type {
  PasswordResetClaim,
  PasswordResetCodeRecord,
} from '../../src/security/types/password-reset-state.types';
import type { AttendeePasswordResetRepository } from '../../src/attendees/types/attendee-password-reset.types';

const HMAC_SECRET = 'unit-test-password-reset-secret-32-characters';

class RecordingCodeState implements PasswordResetCodeState {
  cancelled = false;
  claimResults: PasswordResetClaim[] = [];
  completed = false;
  completionFailures = 0;
  saved?: PasswordResetCodeRecord;

  cancel(): Promise<void> {
    this.cancelled = true;
    return Promise.resolve();
  }

  claim(): Promise<PasswordResetClaim> {
    return Promise.resolve(this.claimResults.shift() ?? { status: 'invalid' });
  }

  markCompleted(): Promise<void> {
    if (this.completionFailures > 0) {
      this.completionFailures -= 1;
      return Promise.reject(new Error('redis unavailable'));
    }

    this.completed = true;
    return Promise.resolve();
  }

  releaseClaim(): Promise<void> {
    return Promise.resolve();
  }

  reserve(): Promise<{ allowed: true; retryAfterSeconds: 0 }> {
    return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
  }

  save(record: PasswordResetCodeRecord): Promise<void> {
    this.saved = record;
    return Promise.resolve();
  }
}

function createService(options?: {
  codeState?: RecordingCodeState;
  events?: string[];
  publisherFails?: boolean;
}): {
  codeState: RecordingCodeState;
  service: AttendeePasswordResetService;
} {
  const codeState = options?.codeState ?? new RecordingCodeState();
  const events = options?.events ?? [];
  const completedResetIds = new Set<string>();
  const accounts: AttendeePasswordResetRepository = {
    completedPasswordReset: (_attendeeId, resetId) =>
      Promise.resolve(completedResetIds.has(resetId)),
    findAccountForPasswordReset: () =>
      Promise.resolve({
        attendeeId: 'attendee-1',
        email: 'attendee@example.com',
      }),
    replacePassword: (_attendeeId, _passwordHash, resetId) => {
      events.push('password-replaced');
      completedResetIds.add(resetId);
      return Promise.resolve(true);
    },
  };
  const publisher: AttendeeAuthJobPublisher = {
    publishEmailVerification: () => Promise.resolve(),
    publishPasswordReset: () =>
      options?.publisherFails
        ? Promise.reject(new Error('broker unavailable'))
        : Promise.resolve(),
  };
  const hasher: PasswordHasher = {
    hash: () => {
      events.push('password-hashed');
      return Promise.resolve('replacement-hash');
    },
  };
  const sessions = {
    cancelPasswordReset: () => Promise.resolve(),
    startPasswordReset: () => {
      events.push('sessions-blocked-and-revoked');
      return Promise.resolve(2);
    },
  } satisfies Pick<
    AttendeeSessionService,
    'cancelPasswordReset' | 'startPasswordReset'
  >;

  return {
    codeState,
    service: new AttendeePasswordResetService(
      accounts,
      codeState,
      publisher,
      hasher,
      sessions,
      HMAC_SECRET,
    ),
  };
}

describe('AttendeePasswordResetService', () => {
  it('accepts a request when delivery publication fails and removes unusable reset state', async () => {
    const { codeState, service } = createService({
      publisherFails: true,
    });

    await expect(
      service.forgotPassword(' Attendee@Example.com '),
    ).resolves.toEqual({ accepted: true });
    expect(codeState.saved).toMatchObject({
      accountId: 'attendee-1',
      attempts: 5,
    });
    expect(codeState.cancelled).toBe(true);
  });

  it('recovers an exact retry from the committed password reset without repeating the mutation', async () => {
    const events: string[] = [];
    const codeState = new RecordingCodeState();
    codeState.claimResults = [
      { accountId: 'attendee-1', resetId: 'reset-1', status: 'claimed' },
      { accountId: 'attendee-1', resetId: 'reset-1', status: 'processing' },
    ];
    codeState.completionFailures = 1;
    const { service } = createService({ codeState, events });

    await expect(
      service.resetPassword(
        'attendee@example.com',
        '123456',
        'Replacement-password-2026!',
      ),
    ).resolves.toEqual({ passwordReset: true });
    await expect(
      service.resetPassword(
        'attendee@example.com',
        '123456',
        'Replacement-password-2026!',
      ),
    ).resolves.toEqual({ passwordReset: true });

    expect(events).toEqual([
      'sessions-blocked-and-revoked',
      'password-hashed',
      'password-replaced',
    ]);
    expect(codeState.completed).toBe(true);
  });
});
