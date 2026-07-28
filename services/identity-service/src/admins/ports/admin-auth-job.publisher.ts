import type { AdminActivationOtp } from '../types/admin-activation.types';
import type { AdminPasswordResetCode } from '../types/admin-password-reset.types';

export interface AdminAuthJobPublisher {
  publishActivation(otp: AdminActivationOtp): Promise<void>;
  publishPasswordReset(code: AdminPasswordResetCode): Promise<void>;
}
