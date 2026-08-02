export interface RuntimeConfig {
  cloudflareR2AccessKeyId: string;
  cloudflareR2AccountId: string;
  cloudflareR2Bucket: string;
  cloudflareR2PublicBaseUrl: string;
  cloudflareR2SecretAccessKey: string;
  databaseUrl: string;
  grpcHost: string;
  grpcPort: number;
  healthPort: number;
  r2RequestTimeoutMs: number;
  rabbitMqConnectTimeoutMs: number;
  rabbitMqPublishTimeoutMs: number;
  rabbitMqUrl: string;
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
  const value = Number(readRequiredString(environment, name));

  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  return value;
}

function readPositiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
): number {
  const value = Number(readRequiredString(environment, name));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function readUrl(environment: NodeJS.ProcessEnv, name: string): string {
  const value = readRequiredString(environment, name);
  try {
    return new URL(value).toString().replace(/\/$/, '');
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

function readRabbitMqUrl(environment: NodeJS.ProcessEnv): string {
  const value = readRequiredString(environment, 'RABBITMQ_URL');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('RABBITMQ_URL must be a valid amqp:// or amqps:// URL');
  }
  if (!['amqp:', 'amqps:'].includes(parsed.protocol)) {
    throw new Error('RABBITMQ_URL must be a valid amqp:// or amqps:// URL');
  }
  return value;
}

export function readDatabaseUrl(environment: NodeJS.ProcessEnv): string {
  return readRequiredString(environment, 'DATABASE_URL');
}

export function readRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): RuntimeConfig {
  return {
    cloudflareR2AccessKeyId: readRequiredString(
      environment,
      'CLOUDFLARE_R2_ACCESS_KEY_ID',
    ),
    cloudflareR2AccountId: readRequiredString(
      environment,
      'CLOUDFLARE_R2_ACCOUNT_ID',
    ),
    cloudflareR2Bucket: readRequiredString(environment, 'CLOUDFLARE_R2_BUCKET'),
    cloudflareR2PublicBaseUrl: readUrl(
      environment,
      'CLOUDFLARE_R2_PUBLIC_BASE_URL',
    ),
    cloudflareR2SecretAccessKey: readRequiredString(
      environment,
      'CLOUDFLARE_R2_SECRET_ACCESS_KEY',
    ),
    databaseUrl: readDatabaseUrl(environment),
    grpcHost: readRequiredString(environment, 'GRPC_HOST'),
    grpcPort: readPort(environment, 'GRPC_PORT'),
    healthPort: readPort(environment, 'HEALTH_PORT'),
    r2RequestTimeoutMs: readPositiveInteger(
      environment,
      'R2_REQUEST_TIMEOUT_MS',
    ),
    rabbitMqConnectTimeoutMs: readPositiveInteger(
      environment,
      'RABBITMQ_CONNECT_TIMEOUT_MS',
    ),
    rabbitMqPublishTimeoutMs: readPositiveInteger(
      environment,
      'RABBITMQ_PUBLISH_TIMEOUT_MS',
    ),
    rabbitMqUrl: readRabbitMqUrl(environment),
  };
}
