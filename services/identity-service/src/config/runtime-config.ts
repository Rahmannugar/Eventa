export interface RuntimeConfig {
  databaseUrl: string;
  emailVerificationHmacSecret: string;
  grpcHost: string;
  grpcPort: number;
  healthPort: number;
  redisConnectTimeoutMs: number;
  redisOperationTimeoutMs: number;
  redisUrl: string;
}

export function readDatabaseUrl(environment: NodeJS.ProcessEnv): string {
  return readRequiredString(environment, 'DATABASE_URL');
}

function readRequiredString(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name];

  if (value === undefined || value.trim() === '') {
    throw new Error(`${name} is required`);
  }

  return value.trim();
}

function readPort(environment: NodeJS.ProcessEnv, name: string): number {
  const value = readRequiredString(environment, name);
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  return port;
}

function readPositiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
): number {
  const value = readRequiredString(environment, name);
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readRedisUrl(environment: NodeJS.ProcessEnv): string {
  const value = readRequiredString(environment, 'REDIS_URL');
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL');
  }

  if (!['redis:', 'rediss:'].includes(url.protocol)) {
    throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL');
  }

  return value;
}

function readEmailVerificationHmacSecret(
  environment: NodeJS.ProcessEnv,
): string {
  const secret = readRequiredString(
    environment,
    'EMAIL_VERIFICATION_HMAC_SECRET',
  );

  if (secret.length < 32) {
    throw new Error(
      'EMAIL_VERIFICATION_HMAC_SECRET must contain at least 32 characters',
    );
  }

  return secret;
}

export function readRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): RuntimeConfig {
  return {
    databaseUrl: readDatabaseUrl(environment),
    emailVerificationHmacSecret: readEmailVerificationHmacSecret(environment),
    grpcHost: readRequiredString(environment, 'GRPC_HOST'),
    grpcPort: readPort(environment, 'GRPC_PORT'),
    healthPort: readPort(environment, 'HEALTH_PORT'),
    redisConnectTimeoutMs: readPositiveInteger(
      environment,
      'REDIS_CONNECT_TIMEOUT_MS',
    ),
    redisOperationTimeoutMs: readPositiveInteger(
      environment,
      'REDIS_OPERATION_TIMEOUT_MS',
    ),
    redisUrl: readRedisUrl(environment),
  };
}
