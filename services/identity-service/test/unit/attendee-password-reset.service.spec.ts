import { describe, expect, it } from 'vitest';

import type { PasswordHasher } from '../../src/security/types/password-hasher.types';
import type { PasswordResetCodeState } from '../../src/attendees/ports/password-reset-code.state';
import type { AttendeeAuthJobPublisher } from '../../src/attendees/ports/attendee-auth-job.publisher';
import { AttendeePasswordResetService } from '../../src/attendees/services/attendee-password-reset.service';
import type { AttendeeSessionService } from '../../src/attendees/services/attendee-session.service';
import type {
  AttendeePasswordResetRepository,
  PasswordResetClaim,
  PasswordResetCodeRecord,
} from '../../src/attendees/types/attendee-password-reset.types';

const HMAC_SECRET = 'unit-test-password-reset-secret-32-characters';

class RecordingCodeState implements PasswordResetCodeState {
  cancelled = false;
  claimResults: PasswordResetClaim[] = [];
  completed = false;
  saved?: PasswordResetCodeRecord;

  cancel(): Promise<void> {
    this.cancelled = true;
    return Promise.resolve();
  }

  claim(): Promise<PasswordResetClaim> {
    return Promise.resolve(
      this.claimResults.shift() ?? { status: 'invalid' },
    );
  }

  markCompleted(): Promise<void> {
    this.completed = true;
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
  const accounts: AttendeePasswordResetRepository = {
    findAccountForPasswordReset: () =>
      Promise.resolve({
        attendeeId: 'attendee-1',
        email: 'attendee@example.com',
      }),
    replacePassword: () => {
      events.push('password-replaced');
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
    revokeAll: () => {
      events.push('sessions-revoked');
      return Promise.resolve(2);
    },
  } satisfies Pick<AttendeeSessionService, 'revokeAll'>;

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
      attendeeId: 'attendee-1',
      attempts: 5,
    });
    expect(codeState.cancelled).toBe(true);
  });

  it('revokes every session before replacing the password and makes exact completion replay mutation-free', async () => {
    const events: string[] = [];
    const codeState = new RecordingCodeState();
    codeState.claimResults = [
      { attendeeId: 'attendee-1', status: 'claimed' },
      { attendeeId: 'attendee-1', status: 'completed' },
    ];
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
      'password-hashed',
      'sessions-revoked',
      'password-replaced',
    ]);
    expect(codeState.completed).toBe(true);
  });
});
