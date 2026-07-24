import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';

import {
  ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
  ATTENDEE_EMAIL_VERIFICATION_QUEUE,
  type AttendeeEmailVerificationJob,
} from '@eventa/messaging-contracts';
import { connect, type Channel, type ChannelModel } from 'amqplib';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { RuntimeConfig } from '../../src/config/runtime-config';
import { RabbitMQClient } from '../../src/infrastructure/clients/rabbitmq.client';
import { EmailDeliveryError } from '../../src/notifications/errors/email-delivery.errors';
import { EmailVerificationJobConsumer } from '../../src/notifications/job-queue/email-verification-job.consumer';
import { EmailVerificationDeliveryRepository } from '../../src/notifications/repositories/email-verification-delivery.repository';
import { EmailVerificationDeliveryService } from '../../src/notifications/services/email-verification-delivery.service';
import type {
  EmailVerificationEmail,
  EmailVerificationEmailSender,
} from '../../src/notifications/types/email-verification-delivery.types';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testRabbitMqUrl = process.env.TEST_RABBITMQ_URL;

if (testDatabaseUrl === undefined || testDatabaseUrl.trim() === '') {
  throw new Error('TEST_DATABASE_URL is required for integration tests');
}

if (testRabbitMqUrl === undefined || testRabbitMqUrl.trim() === '') {
  throw new Error('TEST_RABBITMQ_URL is required for integration tests');
}

const requiredTestDatabaseUrl = testDatabaseUrl;
const requiredTestRabbitMqUrl = testRabbitMqUrl;
const testDatabaseName = new URL(requiredTestDatabaseUrl).pathname.slice(1);

if (!/^[a-z][a-z0-9_]*_test$/.test(testDatabaseName)) {
  throw new Error('TEST_DATABASE_URL must target a database ending in _test');
}

interface DeliveryState {
  attempt_count: number;
  status: string;
}

class RetryOnceEmailSender implements EmailVerificationEmailSender {
  readonly attempts = new Map<string, number>();

  send(email: EmailVerificationEmail): Promise<{ providerMessageId: string }> {
    const attempt = (this.attempts.get(email.jobId) ?? 0) + 1;
    this.attempts.set(email.jobId, attempt);

    if (attempt === 1) {
      return Promise.reject(
        new EmailDeliveryError('EMAIL_PROVIDER_UNAVAILABLE', true),
      );
    }

    return Promise.resolve({
      providerMessageId: `provider-${email.jobId}`,
    });
  }
}

async function ensureTestDatabase(): Promise<void> {
  const adminUrl = new URL(requiredTestDatabaseUrl);
  adminUrl.pathname = '/postgres';
  const adminClient = postgres(adminUrl.toString(), {
    max: 1,
    onnotice: () => undefined,
  });

  try {
    const [databaseState] = await adminClient<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_database
        WHERE datname = ${testDatabaseName}
      ) AS exists
    `;

    if (databaseState?.exists !== true) {
      await adminClient.unsafe(`CREATE DATABASE "${testDatabaseName}"`);
    }
  } catch (error: unknown) {
    if (
      typeof error !== 'object' ||
      error === null ||
      Reflect.get(error, 'code') !== '42P04'
    ) {
      throw error;
    }
  } finally {
    await adminClient.end();
  }
}

function createJob(jobId: string): AttendeeEmailVerificationJob {
  return {
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    jobId,
    otp: '123456',
    recipientEmail: 'attendee@example.com',
    type: ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
  };
}

async function waitForStatus(
  client: ReturnType<typeof postgres>,
  jobId: string,
  expectedStatus: string,
  timeoutMs = 10_000,
): Promise<DeliveryState> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const [delivery] = await client<DeliveryState[]>`
      SELECT attempt_count, status
      FROM email_verification_deliveries
      WHERE job_id = ${jobId}
    `;

    if (delivery?.status === expectedStatus) {
      return delivery;
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }

  throw new Error(`Timed out waiting for ${expectedStatus}`);
}

describe('email verification delivery integration', () => {
  const client = postgres(requiredTestDatabaseUrl, {
    max: 10,
    onnotice: () => undefined,
  });
  const database = drizzle(client);
  const repository = new EmailVerificationDeliveryRepository(client);
  const sender = new RetryOnceEmailSender();
  const service = new EmailVerificationDeliveryService(repository, sender);
  const rabbitMQ = new RabbitMQClient(requiredTestRabbitMqUrl, 2_000);
  const config: RuntimeConfig = {
    databaseUrl: requiredTestDatabaseUrl,
    healthPort: 3006,
    rabbitMqConnectTimeoutMs: 2_000,
    rabbitMqPublishTimeoutMs: 2_000,
    rabbitMqUrl: requiredTestRabbitMqUrl,
    resendApiKey: 're_integration_test',
    resendFrom: 'Eventa <noreply@livepoly.site>',
    resendRequestTimeoutMs: 5_000,
  };
  const consumer = new EmailVerificationJobConsumer(rabbitMQ, service, config);
  let publisherChannel: Channel | undefined;
  let publisherConnection: ChannelModel | undefined;

  function requirePublisherChannel(): Channel {
    if (publisherChannel === undefined) {
      throw new Error('Publisher channel is not initialized');
    }

    return publisherChannel;
  }

  beforeAll(async () => {
    await ensureTestDatabase();
    await migrate(database, {
      migrationsFolder: resolve(process.cwd(), 'drizzle'),
    });
    publisherConnection = await connect(requiredTestRabbitMqUrl);
    publisherChannel = await publisherConnection.createChannel();
    await rabbitMQ.onModuleInit();
    await consumer.onModuleInit();
  });

  beforeEach(async () => {
    const channel = requirePublisherChannel();
    await client`DELETE FROM email_verification_deliveries`;
    sender.attempts.clear();
    await channel.purgeQueue(ATTENDEE_EMAIL_VERIFICATION_QUEUE);
    await Promise.all(
      [5_000, 30_000].map((delayMs) =>
        channel.purgeQueue(
          `${ATTENDEE_EMAIL_VERIFICATION_QUEUE}.retry.${String(delayMs)}ms`,
        ),
      ),
    );
  });

  afterAll(async () => {
    await consumer.onApplicationShutdown();
    await rabbitMQ.onApplicationShutdown();
    await publisherChannel?.close();
    await publisherConnection?.close();
    await client.end();
  });

  it('allows one concurrent claim and suppresses the duplicate behind its lease', async () => {
    const job = createJob('5b0f4c03-4107-4053-9206-77c453410a82');

    const claims = await Promise.all([
      repository.claim(job),
      repository.claim(job),
    ]);

    expect(claims.filter((claim) => claim.kind === 'claimed')).toHaveLength(1);
    expect(claims.filter((claim) => claim.kind === 'busy')).toHaveLength(1);
  });

  it('retries through RabbitMQ once and records only safe durable delivery state', async () => {
    const job = createJob('a3ff9694-eb6d-4d4f-892a-3767359e5883');
    const channel = requirePublisherChannel();

    channel.sendToQueue(
      ATTENDEE_EMAIL_VERIFICATION_QUEUE,
      Buffer.from(JSON.stringify(job)),
      {
        contentType: 'application/json',
        messageId: job.jobId,
        persistent: true,
        type: ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
      },
    );

    const delivery = await waitForStatus(client, job.jobId, 'delivered');

    expect(delivery.attempt_count).toBe(2);
    expect(sender.attempts.get(job.jobId)).toBe(2);

    const columns = await client<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'email_verification_deliveries'
    `;
    expect(columns.map((column) => column.column_name)).not.toContain(
      'recipient_email',
    );
    expect(columns.map((column) => column.column_name)).not.toContain('otp');

    channel.sendToQueue(
      ATTENDEE_EMAIL_VERIFICATION_QUEUE,
      Buffer.from(JSON.stringify(job)),
      {
        contentType: 'application/json',
        messageId: job.jobId,
        persistent: true,
        type: ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
      },
    );
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    expect(sender.attempts.get(job.jobId)).toBe(2);
  }, 15_000);

  it('records a malformed versioned job as rejected without calling the provider', async () => {
    const job = {
      ...createJob('dd770242-a515-4c94-81b4-17e15337e510'),
      otp: '12345',
    };
    const channel = requirePublisherChannel();

    channel.sendToQueue(
      ATTENDEE_EMAIL_VERIFICATION_QUEUE,
      Buffer.from(JSON.stringify(job)),
      {
        contentType: 'application/json',
        messageId: job.jobId,
        persistent: true,
        type: ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
      },
    );

    await waitForStatus(client, job.jobId, 'rejected');
    expect(sender.attempts.has(job.jobId)).toBe(false);
  });
});
