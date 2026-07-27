export interface AttendeeLoginAccount {
  attendeeId: string;
  deletedAt: Date | null;
  email: string;
  emailVerified: boolean;
  passwordHash: string;
  status: 'active' | 'suspended';
  username: string;
}

export interface AttendeeLoginRepository {
  findForLogin(email: string): Promise<AttendeeLoginAccount | undefined>;
}

export interface LoginAttendeeInput {
  email: string;
  password: string;
}

export interface LoggedInAttendee {
  attendeeId: string;
  email: string;
  emailVerified: true;
  sessionExpiresAt: string;
  sessionToken: string;
  status: 'active';
  username: string;
}
