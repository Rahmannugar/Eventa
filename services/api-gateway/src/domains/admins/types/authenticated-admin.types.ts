export interface AuthenticatedAdminSession {
  adminId: string;
  sessionExpiresAt: string;
  sessionId: string;
}

export interface AdminAuthenticatedRequest {
  adminSession: AuthenticatedAdminSession;
  headers: {
    cookie?: string;
    'x-request-id': string;
  };
}
