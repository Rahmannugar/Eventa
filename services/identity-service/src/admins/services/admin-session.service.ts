import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import {
  ADMIN_SESSION_MAX_CONCURRENT,
  ADMIN_SESSION_TOKEN_BYTES,
  ADMIN_SESSION_TTL_MS,
} from '../constants/admin-session.constants';
import type {
  AdminSessionState,
  AdminSessionIssuer,
  IssuedAdminSession,
} from '../types/admin-login.types';

export class AdminSessionService implements AdminSessionIssuer {
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
      tokenDigest: this.digest('admin-session-token\0', token),
      ttlMs: ADMIN_SESSION_TTL_MS,
    });

    return { ...session, token };
  }

  private digest(purpose: string, value: string): string {
    return createHmac('sha256', this.hmacSecret)
      .update(purpose)
      .update(value)
      .digest('hex');
  }
}
