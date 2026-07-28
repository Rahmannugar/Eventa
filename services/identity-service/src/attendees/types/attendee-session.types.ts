export interface CreateAttendeeSession {
  attendeeId: string;
  attendeeSubject: string;
  maxConcurrentSessions: number;
  sessionId: string;
  tokenDigest: string;
  ttlMs: number;
}

export interface AttendeeSession {
  attendeeId: string;
  expiresAt: Date;
  sessionId: string;
}

export interface IssuedAttendeeSession extends AttendeeSession {
  token: string;
}

export interface AttendeeSessionState {
  cancelAccountDeletion(attendeeSubject: string): Promise<void>;
  completeAccountDeletion(
    attendeeSubject: string,
    ttlMs: number,
  ): Promise<void>;
  create(input: CreateAttendeeSession): Promise<AttendeeSession>;
  prepareAccountDeletion(
    attendeeSubject: string,
    ttlMs: number,
  ): Promise<number>;
  read(tokenDigest: string): Promise<AttendeeSession | undefined>;
  revoke(tokenDigest: string): Promise<boolean>;
  revokeAll(attendeeSubject: string): Promise<number>;
}
