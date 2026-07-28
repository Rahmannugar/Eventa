export const ATTENDEE_EMAIL_VERIFICATION_QUEUE =
  'eventa.notification.attendee-email-verification.v1';

export const ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE =
  'attendee.email-verification.v1';

export interface AttendeeEmailVerificationJob {
  expiresAt: string;
  jobId: string;
  otp: string;
  recipientEmail: string;
  type: typeof ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE;
}

export const ATTENDEE_PASSWORD_RESET_QUEUE =
  'eventa.notification.attendee-password-reset.v1';

export const ATTENDEE_PASSWORD_RESET_JOB_TYPE =
  'attendee.password-reset.v1';

export interface AttendeePasswordResetJob {
  code: string;
  expiresAt: string;
  jobId: string;
  recipientEmail: string;
  type: typeof ATTENDEE_PASSWORD_RESET_JOB_TYPE;
}
