import { randomUUID } from 'node:crypto';

import {
  EVENT_MEDIA_UPLOAD_TTL_MS,
  EVENT_MEDIA_VERIFICATION_TTL_MS,
} from '../constants/event-media.constants';
import {
  EventMediaNotFoundError,
  EventMediaUploadInProgressError,
  EventMediaUploadNotFoundError,
  EventNotFoundError,
  EventVersionConflictError,
} from '../errors/event.errors';
import type {
  CreateEventMediaUploadCommand,
  EventMediaManagement,
  EventMediaMutationRepository,
  EventMediaObjectStorage,
  EventMediaUploadIntent,
  EventMediaUploadRepository,
  EventMediaUploadStatusRecord,
  RemoveEventMediaCommand,
} from '../types/event.types';

const EXTENSION_BY_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export class EventMediaApplicationService implements EventMediaManagement {
  constructor(
    private readonly uploads: EventMediaUploadRepository,
    private readonly media: EventMediaMutationRepository,
    private readonly objects: EventMediaObjectStorage,
  ) {}

  async createUpload(
    input: CreateEventMediaUploadCommand,
  ): Promise<EventMediaUploadIntent> {
    const uploadId = randomUUID();
    const objectKey = `events/${input.eventId}/uploads/${uploadId}.${EXTENSION_BY_CONTENT_TYPE[input.contentType]}`;
    const now = Date.now();
    const expiresAt = new Date(now + EVENT_MEDIA_UPLOAD_TTL_MS);
    const verificationDeadlineAt = new Date(
      now + EVENT_MEDIA_VERIFICATION_TTL_MS,
    );
    const signed = await this.objects.createUploadUrl({
      objectKey,
      contentType: input.contentType,
      expiresInSeconds: EVENT_MEDIA_UPLOAD_TTL_MS / 1_000,
    });
    const result = await this.uploads.createUpload({
      ...input,
      uploadId,
      objectKey,
      expiresAt,
      verificationDeadlineAt,
    });

    if (result.outcome === 'not_found') throw new EventNotFoundError();
    if (result.outcome === 'version_conflict') {
      throw new EventVersionConflictError();
    }
    if (result.outcome === 'upload_in_progress') {
      throw new EventMediaUploadInProgressError();
    }

    return {
      uploadId,
      uploadUrl: signed.url,
      requiredHeaders: signed.requiredHeaders,
      expiresAt,
      verificationDeadlineAt,
    };
  }

  async getUploadStatus(
    eventId: string,
    uploadId: string,
  ): Promise<EventMediaUploadStatusRecord> {
    const upload = await this.uploads.findStatus(eventId, uploadId);
    if (upload === undefined) throw new EventMediaUploadNotFoundError();
    return upload;
  }

  async remove(input: RemoveEventMediaCommand): Promise<number> {
    const result = await this.media.remove(input);
    if (result.outcome === 'not_found') throw new EventNotFoundError();
    if (result.outcome === 'version_conflict') {
      throw new EventVersionConflictError();
    }
    if (result.outcome === 'media_not_found') {
      throw new EventMediaNotFoundError();
    }
    return result.eventVersion;
  }
}
