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
