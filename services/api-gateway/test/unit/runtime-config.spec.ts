import { describe, expect, it } from 'vitest';

import { readRuntimeConfig } from '../../src/config/runtime-config';

const validEnvironment = {
  API_DOCS_ENABLED: 'true',
  IDENTITY_GRPC_URL: 'identity-service:50051',
  PORT: '4100',
  RATE_LIMIT_KEY_SECRET: 'a-development-secret-that-is-32-chars',
  REDIS_URL: 'redis://redis:6379',
  TRUST_PROXY_HOPS: '1',
};

describe('readRuntimeConfig', () => {
  it('rejects missing required configuration', () => {
    expect(() => readRuntimeConfig({})).toThrow('PORT is required');
  });

  it('parses the configured port and Identity endpoint', () => {
    expect(
      readRuntimeConfig({
        ...validEnvironment,
      }),
    ).toEqual({
      apiDocsEnabled: true,
      identityGrpcUrl: 'identity-service:50051',
      port: 4100,
      rateLimitKeySecret: 'a-development-secret-that-is-32-chars',
      redisUrl: 'redis://redis:6379',
      trustProxyHops: 1,
    });
  });

  it.each(['0', '65536', 'not-a-number', '3000.5'])(
    'rejects the invalid port %s',
    (port) => {
      expect(() =>
        readRuntimeConfig({
          ...validEnvironment,
          PORT: port,
        }),
      ).toThrow('PORT must be an integer between 1 and 65535');
    },
  );

  it('requires the Identity Service endpoint', () => {
    expect(() =>
      readRuntimeConfig({ ...validEnvironment, IDENTITY_GRPC_URL: '' }),
    ).toThrow('IDENTITY_GRPC_URL is required');
  });

  it.each(['http://identity-service:50051', 'identity-service', ':50051'])(
    'rejects the invalid Identity Service endpoint %s',
    (identityGrpcUrl) => {
      expect(() =>
        readRuntimeConfig({
          ...validEnvironment,
          IDENTITY_GRPC_URL: identityGrpcUrl,
        }),
      ).toThrow('IDENTITY_GRPC_URL must use the host:port format');
    },
  );

  it.each(['http://redis:6379', 'redis', ''])(
    'rejects the invalid Redis URL %s',
    (redisUrl) => {
      expect(() =>
        readRuntimeConfig({ ...validEnvironment, REDIS_URL: redisUrl }),
      ).toThrow();
    },
  );

  it('requires a sufficiently strong rate-limit key secret', () => {
    expect(() =>
      readRuntimeConfig({
        ...validEnvironment,
        RATE_LIMIT_KEY_SECRET: 'too-short',
      }),
    ).toThrow('RATE_LIMIT_KEY_SECRET must be at least 32 characters');
  });

  it.each(['-1', '1.5', 'unknown'])(
    'rejects the invalid trusted proxy hop count %s',
    (trustProxyHops) => {
      expect(() =>
        readRuntimeConfig({
          ...validEnvironment,
          TRUST_PROXY_HOPS: trustProxyHops,
        }),
      ).toThrow('TRUST_PROXY_HOPS must be a non-negative integer');
    },
  );

  it.each(['1', 'yes', 'enabled', ''])(
    'rejects the invalid API docs flag %s',
    (apiDocsEnabled) => {
      expect(() =>
        readRuntimeConfig({
          ...validEnvironment,
          API_DOCS_ENABLED: apiDocsEnabled,
        }),
      ).toThrow();
    },
  );
});
