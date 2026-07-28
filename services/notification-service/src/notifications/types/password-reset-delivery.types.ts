export type PasswordResetDeliveryOutcome =
  | {
      kind: 'delivered' | 'duplicate' | 'expired' | 'failed' | 'rejected';
    }
  | {
      kind: 'retry';
      retryAt: Date;
    };
