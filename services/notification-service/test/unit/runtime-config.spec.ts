import { describe, expect, it } from 'vitest';

import { readRuntimeConfig } from '../../src/config/runtime-config';

const validEnvironment: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgres://notification:password@database:5432/notification',
  HEALTH_PORT: '3006',
  RABBITMQ_CONNECT_TIMEOUT_MS: '2000',
  RABBITMQ_PUBLISH_TIMEOUT_MS: '2000',
  RABBITMQ_URL: 'amqp://eventa:password@job-queue:5672',
  RESEND_API_KEY: 're_test_key',
  RESEND_FROM: 'Eventa <noreply@livepoly.site>',
  RESEND_REQUEST_TIMEOUT_MS: '5000',
};

describe('readRuntimeConfig', () => {
  it('loads the complete Notification runtime contract', () => {
    expect(readRuntimeConfig(validEnvironment)).toEqual({
      databaseUrl:
        'postgres://notification:password@database:5432/notification',
      healthPort: 3006,
      rabbitMqConnectTimeoutMs: 2000,
      rabbitMqPublishTimeoutMs: 2000,
      rabbitMqUrl: 'amqp://eventa:password@job-queue:5672',
      resendApiKey: 're_test_key',
      resendFrom: 'Eventa <noreply@livepoly.site>',
      resendRequestTimeoutMs: 5000,
    });
  });

  it.each([
    'DATABASE_URL',
    'HEALTH_PORT',
    'RABBITMQ_URL',
    'RESEND_API_KEY',
    'RESEND_FROM',
  ])('rejects missing %s', (name) => {
    expect(() =>
      readRuntimeConfig({ ...validEnvironment, [name]: undefined }),
    ).toThrow(`${name} is required`);
  });

  it('rejects a non-AMQP RabbitMQ URL', () => {
    expect(() =>
      readRuntimeConfig({
        ...validEnvironment,
        RABBITMQ_URL: 'https://job-queue.example.com',
      }),
    ).toThrow('RABBITMQ_URL must be a valid amqp:// or amqps:// URL');
  });

  it('keeps the provider timeout within the durable processing lease', () => {
    expect(() =>
      readRuntimeConfig({
        ...validEnvironment,
        RESEND_REQUEST_TIMEOUT_MS: '20001',
      }),
    ).toThrow('RESEND_REQUEST_TIMEOUT_MS must not exceed 20000 milliseconds');
  });
});
