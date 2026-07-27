import { describe, expect, it } from 'vitest';

import {
  AttendeeAccountDeletedError,
  AttendeeAccountSuspendedError,
  AttendeeEmailVerificationRequiredError,
  InvalidAttendeeCredentialsError,
} from '../../src/attendees/errors/attendee-login.errors';
import { AttendeeLoginService } from '../../src/attendees/services/attendee-login.service';
import type { AttendeeSessionService } from '../../src/attendees/services/attendee-session.service';
import type {
  AttendeeLoginAccount,
  AttendeeLoginRepository,
} from '../../src/attendees/types/attendee-login.types';
import type { PasswordVerifier } from '../../src/security/types/password-verifier.types';

const ACCOUNT: AttendeeLoginAccount = {
  attendeeId: 'attendee-1',
  deletedAt: null,
  email: 'attendee@example.com',
  emailVerified: true,
  passwordHash: 'stored-hash',
  status: 'active',
  username: 'eventfan',
};

class RecordingLoginRepository implements AttendeeLoginRepository {
  email?: string;
  result?: AttendeeLoginAccount;

  findForLogin(email: string): Promise<AttendeeLoginAccount | undefined> {
    this.email = email;
    return Promise.resolve(this.result);
  }
}

class RecordingPasswordVerifier implements PasswordVerifier {
  calls: Array<{ password: string; passwordHash: string }> = [];
  result = true;

  verify(passwordHash: string, password: string): Promise<boolean> {
    this.calls.push({ password, passwordHash });
    return Promise.resolve(this.result);
  }
}

class RecordingSessions {
  attendeeIds: string[] = [];

  issue(attendeeId: string) {
    this.attendeeIds.push(attendeeId);
    return Promise.resolve({
      attendeeId,
      expiresAt: new Date('2026-08-03T12:00:00.000Z'),
      sessionId: 'session-1',
      token: 'session-token',
    });
  }
}

function setup() {
  const repository = new RecordingLoginRepository();
  const verifier = new RecordingPasswordVerifier();
  const sessions = new RecordingSessions();
  const service = new AttendeeLoginService(
    repository,
    verifier,
    sessions as unknown as AttendeeSessionService,
  );
  return { repository, service, sessions, verifier };
}

describe('AttendeeLoginService', () => {
  it('verifies a normalized account and issues exactly one session', async () => {
    const { repository, service, sessions, verifier } = setup();
    repository.result = ACCOUNT;

    await expect(
      service.login({
        email: '  Attendee@Example.COM ',
        password: 'correct-password',
      }),
    ).resolves.toEqual({
      attendeeId: 'attendee-1',
      email: 'attendee@example.com',
      emailVerified: true,
      sessionExpiresAt: '2026-08-03T12:00:00.000Z',
      sessionToken: 'session-token',
      status: 'active',
      username: 'eventfan',
    });
    expect(repository.email).toBe('attendee@example.com');
    expect(verifier.calls).toEqual([
      { password: 'correct-password', passwordHash: 'stored-hash' },
    ]);
    expect(sessions.attendeeIds).toEqual(['attendee-1']);
  });

  it('uses the same credential failure for an unknown account and does not issue a session', async () => {
    const { service, sessions, verifier } = setup();

    await expect(
      service.login({
        email: 'missing@example.com',
        password: 'wrong-password',
      }),
    ).rejects.toBeInstanceOf(InvalidAttendeeCredentialsError);
    expect(verifier.calls).toHaveLength(1);
    expect(verifier.calls[0]?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(sessions.attendeeIds).toEqual([]);
  });

  it('rejects a wrong password without issuing a session', async () => {
    const { repository, service, sessions, verifier } = setup();
    repository.result = ACCOUNT;
    verifier.result = false;

    await expect(
      service.login({
        email: 'attendee@example.com',
        password: 'wrong-password',
      }),
    ).rejects.toBeInstanceOf(InvalidAttendeeCredentialsError);
    expect(sessions.attendeeIds).toEqual([]);
  });

  it('requires verified email after a correct password and before session issuance', async () => {
    const { repository, service, sessions } = setup();
    repository.result = { ...ACCOUNT, emailVerified: false };

    await expect(
      service.login({
        email: 'attendee@example.com',
        password: 'correct-password',
      }),
    ).rejects.toBeInstanceOf(AttendeeEmailVerificationRequiredError);
    expect(sessions.attendeeIds).toEqual([]);
  });

  it('returns the deleted-account outcome only after a correct password', async () => {
    const { repository, service, sessions } = setup();
    repository.result = { ...ACCOUNT, deletedAt: new Date() };

    await expect(
      service.login({
        email: 'attendee@example.com',
        password: 'correct-password',
      }),
    ).rejects.toBeInstanceOf(AttendeeAccountDeletedError);
    expect(sessions.attendeeIds).toEqual([]);
  });

  it('returns the suspended-account outcome only after a correct password', async () => {
    const { repository, service, sessions } = setup();
    repository.result = { ...ACCOUNT, status: 'suspended' };

    await expect(
      service.login({
        email: 'attendee@example.com',
        password: 'correct-password',
      }),
    ).rejects.toBeInstanceOf(AttendeeAccountSuspendedError);
    expect(sessions.attendeeIds).toEqual([]);
  });
});
