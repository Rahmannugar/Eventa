export type Actor = 'admin' | 'attendee';

export interface AdminAccount {
  actor: 'admin';
  adminId: string;
  email: string;
}

export interface AttendeeAccount {
  actor: 'attendee';
  attendeeId: string;
  email: string;
  emailVerified: true;
  status: 'active';
  username: string;
}

export type SessionAccount = AdminAccount | AttendeeAccount;

export interface LoginInput {
  email: string;
  password: string;
}
