export interface RuntimeConfig {
  databaseUrl: string;
  healthPort: number;
  rabbitMqConnectTimeoutMs: number;
  rabbitMqPublishTimeoutMs: number;
  rabbitMqUrl: string;
  resendApiKey: string;
  resendFrom: string;
  resendRequestTimeoutMs: number;
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

function readPositiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
): number {
  const parsed = Number(readRequiredString(environment, name));

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function readPort(environment: NodeJS.ProcessEnv, name: string): number {
  const port = readPositiveInteger(environment, name);

  if (port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  return port;
}

function readRabbitMqUrl(environment: NodeJS.ProcessEnv): string {
  const value = readRequiredString(environment, 'RABBITMQ_URL');
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('RABBITMQ_URL must be a valid amqp:// or amqps:// URL');
  }

  if (!['amqp:', 'amqps:'].includes(url.protocol)) {
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
  const resendRequestTimeoutMs = readPositiveInteger(
    environment,
    'RESEND_REQUEST_TIMEOUT_MS',
  );

  if (resendRequestTimeoutMs > 20_000) {
    throw new Error(
      'RESEND_REQUEST_TIMEOUT_MS must not exceed 20000 milliseconds',
    );
  }

  return {
    databaseUrl: readDatabaseUrl(environment),
    healthPort: readPort(environment, 'HEALTH_PORT'),
    rabbitMqConnectTimeoutMs: readPositiveInteger(
      environment,
      'RABBITMQ_CONNECT_TIMEOUT_MS',
    ),
    rabbitMqPublishTimeoutMs: readPositiveInteger(
      environment,
      'RABBITMQ_PUBLISH_TIMEOUT_MS',
    ),
    rabbitMqUrl: readRabbitMqUrl(environment),
    resendApiKey: readRequiredString(environment, 'RESEND_API_KEY'),
    resendFrom: readRequiredString(environment, 'RESEND_FROM'),
    resendRequestTimeoutMs,
  };
}
