import type { AttendeeDeletedEvent } from '@eventa/messaging-contracts/identity/attendee-lifecycle.events';

export interface AttendeeDeletionAccount {
  attendeeId: string;
  passwordHash: string;
}

export interface AttendeeDeletionRepository {
  deleteAccount(attendeeId: string): Promise<AttendeeDeletedEvent | undefined>;
  findAccountForDeletion(
    attendeeId: string,
  ): Promise<AttendeeDeletionAccount | undefined>;
}

export interface AttendeeDeletionSessions {
  cancelAccountDeletion(attendeeId: string): Promise<void>;
  completeAccountDeletion(attendeeId: string, ttlMs: number): Promise<void>;
  prepareAccountDeletion(attendeeId: string, ttlMs: number): Promise<number>;
}

export interface ClaimedAttendeeLifecycleEvent {
  attempt: number;
  claimToken: string;
  event: AttendeeDeletedEvent;
}

export interface AttendeeLifecycleOutbox {
  claimBatch(
    limit: number,
    claimTtlMs: number,
  ): Promise<ClaimedAttendeeLifecycleEvent[]>;
  markPublished(eventId: string, claimToken: string): Promise<boolean>;
  scheduleRetry(
    eventId: string,
    claimToken: string,
    errorCode: string,
    retryAt: Date,
  ): Promise<boolean>;
}
