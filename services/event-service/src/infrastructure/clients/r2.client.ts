import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';

import type { RuntimeConfig } from '../../config/runtime-config';
import { EVENT_MEDIA_MAX_INPUT_PIXELS } from '../../events/constants/event-media.constants';
import type {
  EventMediaContentType,
  EventMediaObjectInspection,
  EventMediaObjectStorage,
  EventMediaUploadRecord,
} from '../../events/types/event.types';

const FORMAT_CONTENT_TYPE = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const satisfies Record<string, EventMediaContentType>;

export class R2Client implements EventMediaObjectStorage {
  private readonly bucket: string;
  private readonly client: S3Client;
  private readonly requestTimeoutMs: number;

  constructor(config: RuntimeConfig) {
    this.bucket = config.cloudflareR2Bucket;
    this.requestTimeoutMs = config.r2RequestTimeoutMs;
    this.client = new S3Client({
      credentials: {
        accessKeyId: config.cloudflareR2AccessKeyId,
        secretAccessKey: config.cloudflareR2SecretAccessKey,
      },
      endpoint: `https://${config.cloudflareR2AccountId}.r2.cloudflarestorage.com`,
      region: 'auto',
    });
  }

  async createUploadUrl(input: {
    objectKey: string;
    contentType: EventMediaContentType;
    expiresInSeconds: number;
  }): Promise<{ url: string; requiredHeaders: Record<string, string> }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.objectKey,
      ContentType: input.contentType,
      IfNoneMatch: '*',
    });
    return {
      url: await getSignedUrl(this.client, command, {
        expiresIn: input.expiresInSeconds,
      }),
      requiredHeaders: {
        'Content-Type': input.contentType,
        'If-None-Match': '*',
      },
    };
  }

  async inspect(
    input: EventMediaUploadRecord,
  ): Promise<EventMediaObjectInspection> {
    let head;
    try {
      head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: input.objectKey }),
        { abortSignal: AbortSignal.timeout(this.requestTimeoutMs) },
      );
    } catch (error: unknown) {
      if (this.isNotFound(error)) return { outcome: 'missing' };
      throw error;
    }

    if (head.ContentLength !== input.declaredSizeBytes) {
      return { outcome: 'invalid', failureCode: 'MEDIA_SIZE_MISMATCH' };
    }
    if (head.ContentType !== input.declaredContentType) {
      return { outcome: 'invalid', failureCode: 'MEDIA_TYPE_MISMATCH' };
    }
    if (head.ETag === undefined) {
      return { outcome: 'invalid', failureCode: 'MEDIA_ETAG_MISSING' };
    }

    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: input.objectKey }),
      { abortSignal: AbortSignal.timeout(this.requestTimeoutMs) },
    );
    if (object.Body === undefined) {
      return { outcome: 'invalid', failureCode: 'MEDIA_BODY_MISSING' };
    }

    try {
      const bytes = Buffer.from(await object.Body.transformToByteArray());
      if (bytes.byteLength !== input.declaredSizeBytes) {
        return { outcome: 'invalid', failureCode: 'MEDIA_SIZE_MISMATCH' };
      }
      const metadata = await sharp(bytes, {
        limitInputPixels: EVENT_MEDIA_MAX_INPUT_PIXELS,
      }).metadata();
      const detectedContentType =
        metadata.format === undefined
          ? undefined
          : FORMAT_CONTENT_TYPE[
              metadata.format as keyof typeof FORMAT_CONTENT_TYPE
            ];
      if (
        detectedContentType !== input.declaredContentType ||
        metadata.width === undefined ||
        metadata.height === undefined
      ) {
        return { outcome: 'invalid', failureCode: 'MEDIA_CONTENT_INVALID' };
      }
      return {
        outcome: 'verified',
        object: {
          contentType: detectedContentType,
          sizeBytes: bytes.byteLength,
          width: metadata.width,
          height: metadata.height,
          etag: head.ETag.replaceAll('"', ''),
        },
      };
    } catch {
      return { outcome: 'invalid', failureCode: 'MEDIA_CONTENT_INVALID' };
    }
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      { abortSignal: AbortSignal.timeout(this.requestTimeoutMs) },
    );
  }

  private isNotFound(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (Reflect.get(error, 'name') === 'NotFound' ||
        Reflect.get(Reflect.get(error, '$metadata') ?? {}, 'httpStatusCode') ===
          404)
    );
  }
}
