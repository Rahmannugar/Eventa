import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import {
  ATTENDEE_SESSION_MAX_CONCURRENT,
  ATTENDEE_SESSION_TOKEN_BYTES,
  ATTENDEE_SESSION_TTL_MS,
} from '../constants/attendee-session.constants';
import type {
  AttendeeSession,
  AttendeeSessionState,
  IssuedAttendeeSession,
} from '../types/attendee-session.types';

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export class AttendeeSessionService {
  constructor(
    private readonly state: AttendeeSessionState,
    private readonly hmacSecret: string,
  ) {}

  async issue(attendeeId: string): Promise<IssuedAttendeeSession> {
    const token = randomBytes(ATTENDEE_SESSION_TOKEN_BYTES).toString(
      'base64url',
    );
    const session = await this.state.create({
      attendeeId,
      attendeeSubject: this.attendeeSubject(attendeeId),
      maxConcurrentSessions: ATTENDEE_SESSION_MAX_CONCURRENT,
      sessionId: randomUUID(),
      tokenDigest: this.tokenDigest(token),
      ttlMs: ATTENDEE_SESSION_TTL_MS,
    });

    return { ...session, token };
  }

  authenticate(token: string): Promise<AttendeeSession | undefined> {
    if (!SESSION_TOKEN_PATTERN.test(token)) {
      return Promise.resolve(undefined);
    }

    return this.state.read(this.tokenDigest(token));
  }

  revoke(token: string): Promise<boolean> {
    if (!SESSION_TOKEN_PATTERN.test(token)) {
      return Promise.resolve(false);
    }

    return this.state.revoke(this.tokenDigest(token));
  }

  revokeAll(attendeeId: string): Promise<number> {
    return this.state.revokeAll(this.attendeeSubject(attendeeId));
  }

  private attendeeSubject(attendeeId: string): string {
    return this.digest('attendee-session-account\0', attendeeId);
  }

  private digest(purpose: string, value: string): string {
    return createHmac('sha256', this.hmacSecret)
      .update(purpose)
      .update(value)
      .digest('hex');
  }

  private tokenDigest(token: string): string {
    return this.digest('attendee-session-token\0', token);
  }
}
