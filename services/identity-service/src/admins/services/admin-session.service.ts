import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import {
  ADMIN_SESSION_MAX_CONCURRENT,
  ADMIN_SESSION_TOKEN_BYTES,
  ADMIN_SESSION_TTL_MS,
} from '../constants/admin-session.constants';
import { InvalidAdminSessionError } from '../errors/admin-session.errors';
import type {
  AdminSession,
  AdminSessionIssuer,
  AdminSessionState,
  IssuedAdminSession,
} from '../types/admin-session.types';

export class AdminSessionService implements AdminSessionIssuer {
  private static readonly TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

  constructor(
    private readonly state: AdminSessionState,
    private readonly hmacSecret: string,
  ) {}

  async issue(adminId: string): Promise<IssuedAdminSession> {
    const token = randomBytes(ADMIN_SESSION_TOKEN_BYTES).toString('base64url');
    const session = await this.state.create({
      adminId,
      adminSubject: this.digest('admin-session-account\0', adminId),
      maxConcurrentSessions: ADMIN_SESSION_MAX_CONCURRENT,
      sessionId: randomUUID(),
      tokenDigest: this.tokenDigest(token),
      ttlMs: ADMIN_SESSION_TTL_MS,
    });

    return { ...session, token };
  }

  async require(token: string): Promise<AdminSession> {
    const session = await this.authenticate(token);

    if (session === undefined) {
      throw new InvalidAdminSessionError();
    }

    return session;
  }

  revoke(token: string): Promise<boolean> {
    if (!AdminSessionService.TOKEN_PATTERN.test(token)) {
      return Promise.resolve(false);
    }

    return this.state.revoke(this.tokenDigest(token));
  }

  private authenticate(token: string): Promise<AdminSession | undefined> {
    if (!AdminSessionService.TOKEN_PATTERN.test(token)) {
      return Promise.resolve(undefined);
    }

    return this.state.read(this.tokenDigest(token));
  }

  private digest(purpose: string, value: string): string {
    return createHmac('sha256', this.hmacSecret)
      .update(purpose)
      .update(value)
      .digest('hex');
  }

  private tokenDigest(token: string): string {
    return this.digest('admin-session-token\0', token);
  }
}
