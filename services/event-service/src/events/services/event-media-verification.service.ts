import { randomUUID } from 'node:crypto';

import {
  EVENT_MEDIA_CLAIM_LEASE_MS,
  EVENT_MEDIA_MAX_OBJECT_DELETION_ATTEMPTS,
  EVENT_MEDIA_RETRY_DELAYS_MS,
} from '../constants/event-media.constants';
import type {
  EventMediaObjectStorage,
  EventMediaUploadRecord,
  EventMediaUploadRepository,
  EventMediaVerificationOutcome,
} from '../types/event.types';

export class EventMediaVerificationService {
  constructor(
    private readonly uploads: EventMediaUploadRepository,
    private readonly objects: EventMediaObjectStorage,
  ) {}

  async verify(uploadId: string): Promise<EventMediaVerificationOutcome> {
    const claimToken = randomUUID();
    const upload = await this.uploads.claim(
      uploadId,
      claimToken,
      new Date(Date.now() + EVENT_MEDIA_CLAIM_LEASE_MS),
    );
    if (upload === undefined) return { kind: 'completed' };

    if (upload.status !== 'pending') {
      return this.deleteRejectedObject(upload);
    }

    let inspection;
    try {
      inspection = await this.objects.inspect(upload);
    } catch {
      if (Date.now() >= upload.verificationDeadlineAt.getTime()) {
        const rejected = await this.uploads.markTerminal(
          uploadId,
          claimToken,
          'rejected',
          'MEDIA_VERIFICATION_DEADLINE_EXCEEDED',
        );
        return this.deleteRejectedObject(rejected);
      }
      return this.scheduleRetry(
        uploadId,
        claimToken,
        upload.attemptCount,
        upload.verificationDeadlineAt,
      );
    }

    if (inspection.outcome === 'missing') {
      if (Date.now() >= upload.expiresAt.getTime()) {
        const expired = await this.uploads.markTerminal(
          uploadId,
          claimToken,
          'expired',
          'MEDIA_UPLOAD_EXPIRED',
        );
        return this.deleteRejectedObject(expired);
      }
      return this.scheduleRetry(
        uploadId,
        claimToken,
        upload.attemptCount,
        upload.expiresAt,
      );
    }
    if (inspection.outcome === 'invalid') {
      const rejected = await this.uploads.markTerminal(
        uploadId,
        claimToken,
        'rejected',
        inspection.failureCode,
      );
      return this.deleteRejectedObject(rejected);
    }

    const attached = await this.uploads.attachVerified(
      upload,
      inspection.object,
    );
    if (attached.outcome === 'attached') return { kind: attached.mutation };
    if (attached.upload.status === 'attached') return { kind: 'completed' };
    return this.deleteRejectedObject(attached.upload);
  }

  private async deleteRejectedObject(
    upload: EventMediaUploadRecord,
  ): Promise<EventMediaVerificationOutcome> {
    if (upload.objectDeletedAt !== null) return { kind: 'completed' };
    if (
      upload.objectDeletionFailedAt !== null ||
      upload.objectDeletionAttemptCount >=
        EVENT_MEDIA_MAX_OBJECT_DELETION_ATTEMPTS
    ) {
      if (
        upload.objectDeletionFailedAt === null &&
        upload.claimToken !== null
      ) {
        await this.uploads.markObjectDeletionFailed(
          upload.uploadId,
          upload.claimToken,
        );
      }
      return { kind: 'object_deletion_failed' };
    }

    try {
      await this.objects.delete(upload.objectKey);
      await this.uploads.markObjectDeleted(upload.uploadId, upload.claimToken!);
      return {
        kind:
          upload.status === 'pending' || upload.status === 'attached'
            ? 'completed'
            : upload.status,
      };
    } catch {
      return this.scheduleRetry(
        upload.uploadId,
        upload.claimToken!,
        upload.objectDeletionAttemptCount,
      );
    }
  }

  private async scheduleRetry(
    uploadId: string,
    claimToken: string,
    attemptCount: number,
    deadline?: Date,
  ): Promise<EventMediaVerificationOutcome> {
    const index = Math.min(
      Math.max(attemptCount - 1, 0),
      EVENT_MEDIA_RETRY_DELAYS_MS.length - 1,
    );
    const requested = Date.now() + EVENT_MEDIA_RETRY_DELAYS_MS[index]!;
    const retryAt = new Date(
      deadline === undefined
        ? requested
        : Math.min(requested, deadline.getTime()),
    );
    await this.uploads.scheduleRetry(uploadId, claimToken, retryAt);
    return { kind: 'retry', retryAt };
  }
}
