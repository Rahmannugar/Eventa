export type AdminActivationDeliveryOutcome =
  | { kind: 'delivered' | 'duplicate' | 'expired' | 'failed' | 'rejected' }
  | { kind: 'retry'; retryAt: Date };
