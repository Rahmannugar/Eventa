export interface AdminLoginAccount {
  activated: boolean;
  adminId: string;
  email: string;
  passwordHash: string | null;
}

export interface AdminLoginRepository {
  findForLogin(email: string): Promise<AdminLoginAccount | undefined>;
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
  create(input: {
    adminId: string;
    adminSubject: string;
    maxConcurrentSessions: number;
    sessionId: string;
    tokenDigest: string;
    ttlMs: number;
  }): Promise<AdminSession>;
}

export interface LoggedInAdmin {
  adminId: string;
  email: string;
  sessionExpiresAt: string;
  sessionToken: string;
}
