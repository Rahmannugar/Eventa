export interface AdminAccount {
  adminId: string;
  email: string;
}

export interface AdminAccountRepository {
  findActivatedAccount(adminId: string): Promise<AdminAccount | undefined>;
}

export interface CreateAdminSession {
  adminId: string;
  adminSubject: string;
  maxConcurrentSessions: number;
  sessionId: string;
  tokenDigest: string;
  ttlMs: number;
}

export interface AdminSession {
  adminId: string;
  expiresAt: Date;
  sessionId: string;
}

export interface IssuedAdminSession extends AdminSession {
  token: string;
}

export interface AdminSessionIssuer {
  issue(adminId: string): Promise<IssuedAdminSession>;
}

export interface AdminSessionState {
  create(input: CreateAdminSession): Promise<AdminSession>;
  read(tokenDigest: string): Promise<AdminSession | undefined>;
  revoke(tokenDigest: string): Promise<boolean>;
}
