export type EmailVerificationDeliveryOutcome =
  | {
      kind: 'delivered' | 'duplicate' | 'expired' | 'failed' | 'rejected';
    }
  | {
      kind: 'retry';
      retryAt: Date;
    };
