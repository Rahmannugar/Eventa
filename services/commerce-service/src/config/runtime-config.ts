export interface RuntimeConfig {
  databaseUrl: string;
  eventGrpcDeadlineMs: number;
  eventGrpcUrl: string;
  grpcHost: string;
  grpcPort: number;
  healthPort: number;
  stripeMaxNetworkRetries: number;
  stripeSecretKey: string;
  stripeTimeoutMs: number;
  stripeWebhookSecret: string;
}

function readRequiredString(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name];
  if (value === undefined || value.trim() === '')
    throw new Error(`${name} is required`);
  return value.trim();
}

export function readDatabaseUrl(environment: NodeJS.ProcessEnv): string {
  return readRequiredString(environment, 'DATABASE_URL');
}

export function readRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): RuntimeConfig {
  const eventGrpcUrl = readRequiredString(environment, 'EVENT_GRPC_URL');
  if (!/^[^\s:/]+:\d+$/.test(eventGrpcUrl)) {
    throw new Error('EVENT_GRPC_URL must use the host:port format');
  }
  const eventGrpcDeadlineMs = Number(
    readRequiredString(environment, 'EVENT_GRPC_DEADLINE_MS'),
  );
  if (
    !Number.isSafeInteger(eventGrpcDeadlineMs) ||
    eventGrpcDeadlineMs < 100 ||
    eventGrpcDeadlineMs > 10_000
  ) {
    throw new Error(
      'EVENT_GRPC_DEADLINE_MS must be an integer between 100 and 10000',
    );
  }
  const healthPort = Number(readRequiredString(environment, 'HEALTH_PORT'));
  if (!Number.isInteger(healthPort) || healthPort < 1 || healthPort > 65_535) {
    throw new Error('HEALTH_PORT must be an integer between 1 and 65535');
  }
  const grpcPort = Number(readRequiredString(environment, 'GRPC_PORT'));
  if (!Number.isInteger(grpcPort) || grpcPort < 1 || grpcPort > 65_535) {
    throw new Error('GRPC_PORT must be an integer between 1 and 65535');
  }
  const stripeTimeoutMs = Number(
    readRequiredString(environment, 'STRIPE_TIMEOUT_MS'),
  );
  if (
    !Number.isSafeInteger(stripeTimeoutMs) ||
    stripeTimeoutMs < 100 ||
    stripeTimeoutMs > 10_000
  ) {
    throw new Error(
      'STRIPE_TIMEOUT_MS must be an integer between 100 and 10000',
    );
  }
  const stripeMaxNetworkRetries = Number(
    readRequiredString(environment, 'STRIPE_MAX_NETWORK_RETRIES'),
  );
  if (
    !Number.isSafeInteger(stripeMaxNetworkRetries) ||
    stripeMaxNetworkRetries < 0 ||
    stripeMaxNetworkRetries > 2
  ) {
    throw new Error(
      'STRIPE_MAX_NETWORK_RETRIES must be an integer between 0 and 2',
    );
  }
  return {
    databaseUrl: readDatabaseUrl(environment),
    eventGrpcDeadlineMs,
    eventGrpcUrl,
    grpcHost: readRequiredString(environment, 'GRPC_HOST'),
    grpcPort,
    healthPort,
    stripeMaxNetworkRetries,
    stripeSecretKey: readRequiredString(environment, 'STRIPE_SECRET_KEY'),
    stripeTimeoutMs,
    stripeWebhookSecret: readRequiredString(
      environment,
      'STRIPE_WEBHOOK_SECRET',
    ),
  };
}
