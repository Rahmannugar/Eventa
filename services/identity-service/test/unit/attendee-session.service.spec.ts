import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  ATTENDEE_SESSION_MAX_CONCURRENT,
  ATTENDEE_SESSION_TTL_MS,
} from '../../src/attendees/constants/attendee-session.constants';
import { AttendeeSessionService } from '../../src/attendees/services/attendee-session.service';
import type {
  AttendeeSession,
  AttendeeSessionState,
  CreateAttendeeSession,
} from '../../src/attendees/types/attendee-session.types';

const HMAC_SECRET = 'unit-test-attendee-session-secret-32-characters';

class RecordingSessionState implements AttendeeSessionState {
  createInput?: CreateAttendeeSession;
  readDigest?: string;
  revokeDigest?: string;
  revokeSubject?: string;
  readResult?: AttendeeSession;

  create(input: CreateAttendeeSession): Promise<AttendeeSession> {
    this.createInput = input;
    return Promise.resolve({
      attendeeId: input.attendeeId,
      expiresAt: new Date(Date.now() + input.ttlMs),
      sessionId: input.sessionId,
    });
  }

  read(tokenDigest: string): Promise<AttendeeSession | undefined> {
    this.readDigest = tokenDigest;
    return Promise.resolve(this.readResult);
  }

  revoke(tokenDigest: string): Promise<boolean> {
    this.revokeDigest = tokenDigest;
    return Promise.resolve(true);
  }

  revokeAll(attendeeSubject: string): Promise<number> {
    this.revokeSubject = attendeeSubject;
    return Promise.resolve(2);
  }
}

function digest(label: string, value: string): string {
  return createHmac('sha256', HMAC_SECRET)
    .update(label)
    .update(value)
    .digest('hex');
}

describe('AttendeeSessionService', () => {
  it('issues an opaque token through the seven-day, three-session state policy', async () => {
    const state = new RecordingSessionState();
    const service = new AttendeeSessionService(state, HMAC_SECRET);

    const issued = await service.issue('attendee-1');

    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.sessionId).toBe(state.createInput?.sessionId);
    expect(state.createInput).toMatchObject({
      attendeeId: 'attendee-1',
      attendeeSubject: digest('attendee-session-account\0', 'attendee-1'),
      maxConcurrentSessions: ATTENDEE_SESSION_MAX_CONCURRENT,
      tokenDigest: digest('attendee-session-token\0', issued.token),
      ttlMs: ATTENDEE_SESSION_TTL_MS,
    });
  });

  it('authenticates, revokes one token, and revokes every session by protected subject', async () => {
    const state = new RecordingSessionState();
    const service = new AttendeeSessionService(state, HMAC_SECRET);
    const issued = await service.issue('attendee-1');
    const expectedDigest = digest('attendee-session-token\0', issued.token);
    state.readResult = {
      attendeeId: 'attendee-1',
      expiresAt: issued.expiresAt,
      sessionId: issued.sessionId,
    };

    await expect(service.authenticate(issued.token)).resolves.toEqual(
      state.readResult,
    );
    await expect(service.revoke(issued.token)).resolves.toBe(true);
    await expect(service.revokeAll('attendee-1')).resolves.toBe(2);
    expect(state.readDigest).toBe(expectedDigest);
    expect(state.revokeDigest).toBe(expectedDigest);
    expect(state.revokeSubject).toBe(
      digest('attendee-session-account\0', 'attendee-1'),
    );
  });

  it('rejects malformed tokens without consulting Redis state', async () => {
    const state = new RecordingSessionState();
    const service = new AttendeeSessionService(state, HMAC_SECRET);

    await expect(
      service.authenticate('not-a-session'),
    ).resolves.toBeUndefined();
    await expect(service.revoke('not-a-session')).resolves.toBe(false);
    expect(state.readDigest).toBeUndefined();
    expect(state.revokeDigest).toBeUndefined();
  });
});
