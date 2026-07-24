import type { AttendeeEmailVerificationJob } from '@eventa/messaging-contracts';

export type EmailVerificationDeliveryStatus =
  | 'delivered'
  | 'expired'
  | 'failed'
  | 'pending'
  | 'processing'
  | 'rejected'
  | 'retry_scheduled';

export interface ClaimedEmailVerificationDelivery {
  attempt: number;
  claimToken: string;
  kind: 'claimed';
}

export type EmailVerificationDeliveryClaim =
  | ClaimedEmailVerificationDelivery
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
        EmailVerificationDeliveryStatus,
        'delivered' | 'expired' | 'failed' | 'rejected'
      >;
    };

export interface EmailVerificationDeliveryRepository {
  claim(
    job: AttendeeEmailVerificationJob,
  ): Promise<EmailVerificationDeliveryClaim>;
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

export interface EmailVerificationEmail {
  jobId: string;
  otp: string;
  recipientEmail: string;
}

export interface EmailVerificationEmailSender {
  send(email: EmailVerificationEmail): Promise<{ providerMessageId: string }>;
}

export type EmailVerificationDeliveryOutcome =
  | {
      kind: 'delivered' | 'duplicate' | 'expired' | 'failed' | 'rejected';
    }
  | {
      kind: 'retry';
      retryAt: Date;
    };
