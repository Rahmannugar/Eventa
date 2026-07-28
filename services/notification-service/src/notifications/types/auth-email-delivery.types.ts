export type AuthEmailDeliveryStatus =
  | 'delivered'
  | 'expired'
  | 'failed'
  | 'pending'
  | 'processing'
  | 'rejected'
  | 'retry_scheduled';

export interface AuthEmailJob {
  expiresAt: string;
  jobId: string;
  type: string;
}

export type AuthEmailDeliveryClaim =
  | { attempt: number; claimToken: string; kind: 'claimed' }
  | { kind: 'busy'; retryAt: Date }
  | { kind: 'conflict' }
  | {
      kind: 'terminal';
      status: 'delivered' | 'expired' | 'failed' | 'rejected';
    };

export interface AuthEmailDeliveryRepository {
  claim(job: AuthEmailJob): Promise<AuthEmailDeliveryClaim>;
  markDelivered(
    jobId: string,
    claimToken: string,
    providerMessageId: string,
  ): Promise<boolean>;
  markExpired(jobId: string, claimToken?: string): Promise<boolean>;
  markFailed(
    jobId: string,
    claimToken: string,
    failureCode: string,
  ): Promise<boolean>;
  markRetryScheduled(
    jobId: string,
    claimToken: string,
    failureCode: string,
    retryAt: Date,
  ): Promise<boolean>;
  recordRejected(
    jobId: string,
    jobType: string,
    failureCode: string,
  ): Promise<void>;
}
