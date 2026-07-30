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

export interface RegisterAttendeeInput extends LoginInput {
  username: string;
}

export interface RegisteredAttendee {
  attendeeId: string;
  email: string;
  emailVerified: false;
  username: string;
}

export interface ConfirmAttendeeEmailInput {
  email: string;
  otp: string;
}

export interface ResendAttendeeEmailInput {
  email: string;
}

export interface RequestAdminActivationInput {
  email: string;
}

export interface ActivateAdminInput extends RequestAdminActivationInput {
  otp: string;
  password: string;
}
