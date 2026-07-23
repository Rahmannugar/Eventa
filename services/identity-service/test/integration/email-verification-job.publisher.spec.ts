import {
  ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
  ATTENDEE_EMAIL_VERIFICATION_QUEUE,
  type AttendeeEmailVerificationJob,
} from '@eventa/messaging-contracts';
import { connect, type Channel, type ChannelModel } from 'amqplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RabbitMQEmailVerificationJobPublisher } from '../../src/attendees/adapters/job-queue/email-verification-job.publisher';
import { RabbitMQClient } from '../../src/infrastructure/clients/rabbitmq.client';

const testRabbitMqUrl = process.env.TEST_RABBITMQ_URL;

if (testRabbitMqUrl === undefined || testRabbitMqUrl.trim() === '') {
  throw new Error('TEST_RABBITMQ_URL is required for integration tests');
}

describe('RabbitMQEmailVerificationJobPublisher integration', () => {
  let channel: Channel;
  let connection: ChannelModel;
  let publisher: RabbitMQEmailVerificationJobPublisher;
  let rabbitMQ: RabbitMQClient;

  beforeAll(async () => {
    connection = await connect(testRabbitMqUrl);
    channel = await connection.createChannel();
    await channel.assertQueue(ATTENDEE_EMAIL_VERIFICATION_QUEUE, {
      durable: true,
      arguments: { 'x-queue-type': 'quorum' },
    });
    await channel.purgeQueue(ATTENDEE_EMAIL_VERIFICATION_QUEUE);

    rabbitMQ = new RabbitMQClient(testRabbitMqUrl, 2_000);
    await rabbitMQ.onModuleInit();
    publisher = new RabbitMQEmailVerificationJobPublisher(rabbitMQ, 2_000);
  });

  afterAll(async () => {
    await rabbitMQ.onApplicationShutdown();
    await channel.close();
    await connection.close();
  });

  it('publishes one persistent expiring OTP job after broker confirmation', async () => {
    await publisher.publish({
      accountId: 'attendee-1',
      email: 'attendee@example.com',
      otp: '123456',
    });

    const message = await channel.get(ATTENDEE_EMAIL_VERIFICATION_QUEUE, {
      noAck: false,
    });

    expect(message).not.toBe(false);
    if (message === false) {
      return;
    }

    const job = JSON.parse(
      message.content.toString('utf8'),
    ) as AttendeeEmailVerificationJob;
    expect(job).toMatchObject({
      otp: '123456',
      recipientEmail: 'attendee@example.com',
      type: ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE,
    });
    expect(job.jobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(Date.parse(job.expiresAt)).toBeGreaterThan(Date.now());
    expect(message.properties.deliveryMode).toBe(2);
    expect(message.properties.messageId).toBe(job.jobId);
    expect(message.properties.type).toBe(ATTENDEE_EMAIL_VERIFICATION_JOB_TYPE);

    channel.ack(message);
  });
});
