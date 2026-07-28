import type { AttendeePasswordResetJob } from '@eventa/messaging-contracts/identity/attendee-auth.jobs';

export type PasswordResetDeliveryStatus =
  | 'delivered'
  | 'expired'
  | 'failed'
  | 'pending'
  | 'processing'
  | 'rejected'
  | 'retry_scheduled';

export type PasswordResetDeliveryClaim =
  | {
      attempt: number;
      claimToken: string;
      kind: 'claimed';
    }
  | {
      kind: 'busy';
      retryAt: Date;
    }
  | {
      kind: 'conflict';
    }
  | {
      kind: 'terminal';
      status: Extract<
        PasswordResetDeliveryStatus,
        'delivered' | 'expired' | 'failed' | 'rejected'
      >;
    };

export interface PasswordResetDeliveryRepository {
  claim(job: AttendeePasswordResetJob): Promise<PasswordResetDeliveryClaim>;
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
  recordRejected(jobId: string, failureCode: string): Promise<void>;
}

export interface PasswordResetEmail {
  code: string;
  jobId: string;
  recipientEmail: string;
}

export interface PasswordResetEmailSender {
  send(email: PasswordResetEmail): Promise<{ providerMessageId: string }>;
}

export type PasswordResetDeliveryOutcome =
  | {
      kind: 'delivered' | 'duplicate' | 'expired' | 'failed' | 'rejected';
    }
  | {
      kind: 'retry';
      retryAt: Date;
    };
