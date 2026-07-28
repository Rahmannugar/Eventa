export const ADMIN_ACTIVATION_QUEUE = 'eventa.notification.admin-activation.v1';

export const ADMIN_ACTIVATION_JOB_TYPE = 'admin.activation.v1';

export interface AdminActivationJob {
  expiresAt: string;
  jobId: string;
  otp: string;
  recipientEmail: string;
  type: typeof ADMIN_ACTIVATION_JOB_TYPE;
}
