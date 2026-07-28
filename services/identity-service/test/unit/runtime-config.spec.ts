import { describe, expect, it } from 'vitest';

import { readRuntimeConfig } from '../../src/config/runtime-config';

const validEnvironment = {
  ADMIN_AUTH_HMAC_SECRET: 'test-admin-auth-secret-32-characters',
  AUTH_HMAC_SECRET: 'test-auth-secret-at-least-32-characters',
  DATABASE_URL: 'postgresql://identity:test@localhost:5432/eventa_identity',
  GRPC_HOST: '0.0.0.0',
  GRPC_PORT: '50051',
  HEALTH_PORT: '3005',
  KAFKA_BROKERS: 'localhost:9092',
  KAFKA_CONNECTION_TIMEOUT_MS: '2000',
  KAFKA_REQUEST_TIMEOUT_MS: '3000',
  RABBITMQ_CONNECT_TIMEOUT_MS: '2000',
  RABBITMQ_PUBLISH_TIMEOUT_MS: '2000',
  RABBITMQ_URL: 'amqp://localhost:5672',
  REDIS_CONNECT_TIMEOUT_MS: '1000',
  REDIS_OPERATION_TIMEOUT_MS: '750',
  REDIS_URL: 'redis://localhost:6379',
};

describe('readRuntimeConfig', () => {
  it('returns the complete required configuration', () => {
    expect(readRuntimeConfig(validEnvironment)).toEqual({
      adminAuthHmacSecret: validEnvironment.ADMIN_AUTH_HMAC_SECRET,
      authHmacSecret: validEnvironment.AUTH_HMAC_SECRET,
      databaseUrl: validEnvironment.DATABASE_URL,
      grpcHost: validEnvironment.GRPC_HOST,
      grpcPort: 50_051,
      healthPort: 3005,
      kafkaBrokers: ['localhost:9092'],
      kafkaConnectionTimeoutMs: 2000,
      kafkaRequestTimeoutMs: 3000,
      rabbitMqConnectTimeoutMs: 2000,
      rabbitMqPublishTimeoutMs: 2000,
      rabbitMqUrl: validEnvironment.RABBITMQ_URL,
      redisConnectTimeoutMs: 1000,
      redisOperationTimeoutMs: 750,
      redisUrl: validEnvironment.REDIS_URL,
    });
  });

  it.each([
    'ADMIN_AUTH_HMAC_SECRET',
    'AUTH_HMAC_SECRET',
    'DATABASE_URL',
    'GRPC_HOST',
    'GRPC_PORT',
    'HEALTH_PORT',
    'KAFKA_BROKERS',
    'KAFKA_CONNECTION_TIMEOUT_MS',
    'KAFKA_REQUEST_TIMEOUT_MS',
    'RABBITMQ_CONNECT_TIMEOUT_MS',
    'RABBITMQ_PUBLISH_TIMEOUT_MS',
    'RABBITMQ_URL',
    'REDIS_CONNECT_TIMEOUT_MS',
    'REDIS_OPERATION_TIMEOUT_MS',
    'REDIS_URL',
  ] as const)('rejects missing %s configuration', (name) => {
    const environment: NodeJS.ProcessEnv = { ...validEnvironment };
    delete environment[name];

    expect(() => readRuntimeConfig(environment)).toThrow(`${name} is required`);
  });

  it.each([
    ['GRPC_PORT', '0'],
    ['GRPC_PORT', '65536'],
    ['HEALTH_PORT', '3005.5'],
    ['HEALTH_PORT', 'invalid'],
  ] as const)('rejects invalid %s value %s', (name, value) => {
    expect(() =>
      readRuntimeConfig({ ...validEnvironment, [name]: value }),
    ).toThrow(`${name} must be an integer between 1 and 65535`);
  });

  it.each([
    ['RABBITMQ_CONNECT_TIMEOUT_MS', '0'],
    ['KAFKA_CONNECTION_TIMEOUT_MS', '0'],
    ['KAFKA_REQUEST_TIMEOUT_MS', 'invalid'],
    ['RABBITMQ_PUBLISH_TIMEOUT_MS', 'invalid'],
    ['REDIS_CONNECT_TIMEOUT_MS', '0'],
    ['REDIS_CONNECT_TIMEOUT_MS', '1.5'],
    ['REDIS_OPERATION_TIMEOUT_MS', 'invalid'],
  ] as const)('rejects invalid %s value %s', (name, value) => {
    expect(() =>
      readRuntimeConfig({ ...validEnvironment, [name]: value }),
    ).toThrow(`${name} must be a positive integer`);
  });

  it('rejects a non-Redis URL', () => {
    expect(() =>
      readRuntimeConfig({
        ...validEnvironment,
        REDIS_URL: 'https://localhost:6379',
      }),
    ).toThrow('REDIS_URL must be a valid redis:// or rediss:// URL');
  });

  it('rejects a non-AMQP URL', () => {
    expect(() =>
      readRuntimeConfig({
        ...validEnvironment,
        RABBITMQ_URL: 'https://localhost:5672',
      }),
    ).toThrow('RABBITMQ_URL must be a valid amqp:// or amqps:// URL');
  });

  it.each(['ADMIN_AUTH_HMAC_SECRET', 'AUTH_HMAC_SECRET'] as const)(
    'rejects a short %s',
    (name) => {
      expect(() =>
        readRuntimeConfig({
          ...validEnvironment,
          [name]: 'too-short',
        }),
      ).toThrow(`${name} must contain at least 32 characters`);
    },
  );
});
