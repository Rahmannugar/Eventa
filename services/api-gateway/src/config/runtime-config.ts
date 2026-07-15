export interface RuntimeConfig {
  apiDocsEnabled: boolean;
  identityGrpcUrl: string;
  port: number;
  rateLimitKeySecret: string;
  redisUrl: string;
  trustProxyHops: number;
}

function readBoolean(environment: NodeJS.ProcessEnv, name: string): boolean {
  const value = readRequiredString(environment, name).toLowerCase();

  if (!['true', 'false'].includes(value)) {
    throw new Error(`${name} must be either true or false`);
  }

  return value === 'true';
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

export function readRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): RuntimeConfig {
  const rawPort = readRequiredString(environment, 'PORT');

  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const identityGrpcUrl = readRequiredString(environment, 'IDENTITY_GRPC_URL');

  if (!/^[^\s:/]+:\d+$/.test(identityGrpcUrl)) {
    throw new Error('IDENTITY_GRPC_URL must use the host:port format');
  }

  const redisUrl = readRequiredString(environment, 'REDIS_URL');

  let parsedRedisUrl: URL;

  try {
    parsedRedisUrl = new URL(redisUrl);
  } catch {
    throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL');
  }

  if (!['redis:', 'rediss:'].includes(parsedRedisUrl.protocol)) {
    throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL');
  }

  const rateLimitKeySecret = readRequiredString(
    environment,
    'RATE_LIMIT_KEY_SECRET',
  );

  if (rateLimitKeySecret.length < 32) {
    throw new Error('RATE_LIMIT_KEY_SECRET must be at least 32 characters');
  }

  const rawTrustProxyHops = readRequiredString(environment, 'TRUST_PROXY_HOPS');
  const trustProxyHops = Number(rawTrustProxyHops);

  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
    throw new Error('TRUST_PROXY_HOPS must be a non-negative integer');
  }

  return {
    apiDocsEnabled: readBoolean(environment, 'API_DOCS_ENABLED'),
    identityGrpcUrl,
    port,
    rateLimitKeySecret,
    redisUrl,
    trustProxyHops,
  };
}
