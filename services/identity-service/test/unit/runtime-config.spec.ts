import { describe, expect, it } from 'vitest';

import { readRuntimeConfig } from '../../src/config/runtime-config';

const validEnvironment = {
  DATABASE_URL: 'postgresql://identity:test@localhost:5432/eventa_identity',
  GRPC_HOST: '0.0.0.0',
  GRPC_PORT: '50051',
  HEALTH_PORT: '3005',
};

describe('readRuntimeConfig', () => {
  it('returns the complete required configuration', () => {
    expect(readRuntimeConfig(validEnvironment)).toEqual({
      databaseUrl: validEnvironment.DATABASE_URL,
      grpcHost: validEnvironment.GRPC_HOST,
      grpcPort: 50_051,
      healthPort: 3005,
    });
  });

  it.each(['DATABASE_URL', 'GRPC_HOST', 'GRPC_PORT', 'HEALTH_PORT'] as const)(
    'rejects missing %s configuration',
    (name) => {
      const environment: NodeJS.ProcessEnv = { ...validEnvironment };
      delete environment[name];

      expect(() => readRuntimeConfig(environment)).toThrow(
        `${name} is required`,
      );
    },
  );

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
});
