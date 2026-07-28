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
import { InvalidAttendeeSessionError } from '../errors/attendee-session.errors';

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

  cancelAccountDeletion(attendeeId: string): Promise<void> {
    return this.state.cancelAccountDeletion(this.attendeeSubject(attendeeId));
  }

  cancelPasswordReset(attendeeId: string, resetId: string): Promise<void> {
    return this.state.cancelPasswordReset(
      this.attendeeSubject(attendeeId),
      resetId,
    );
  }

  completeAccountDeletion(attendeeId: string, ttlMs: number): Promise<void> {
    return this.state.completeAccountDeletion(
      this.attendeeSubject(attendeeId),
      ttlMs,
    );
  }

  async require(token: string): Promise<AttendeeSession> {
    const session = await this.authenticate(token);

    if (session === undefined) {
      throw new InvalidAttendeeSessionError();
    }

    return session;
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

  prepareAccountDeletion(attendeeId: string, ttlMs: number): Promise<number> {
    return this.state.prepareAccountDeletion(
      this.attendeeSubject(attendeeId),
      ttlMs,
    );
  }

  startPasswordReset(
    attendeeId: string,
    resetId: string,
    ttlMs: number,
  ): Promise<number> {
    return this.state.startPasswordReset(
      this.attendeeSubject(attendeeId),
      resetId,
      ttlMs,
    );
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
