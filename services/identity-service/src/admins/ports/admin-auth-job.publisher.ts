import type { AdminActivationOtp } from '../types/admin-activation.types';

export interface AdminAuthJobPublisher {
  publishActivation(otp: AdminActivationOtp): Promise<void>;
}
