export interface AuthenticatedAttendeeSession {
  attendeeId: string;
  sessionExpiresAt: string;
  sessionId: string;
}

export interface AttendeeAuthenticatedRequest {
  attendeeSession: AuthenticatedAttendeeSession;
  headers: {
    cookie?: string;
    'x-request-id': string;
  };
}
