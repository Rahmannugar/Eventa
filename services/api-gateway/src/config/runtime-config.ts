export interface RuntimeConfig {
  apiDocsEnabled: boolean;
  httpHeadersTimeoutMs: number;
  httpKeepAliveTimeoutMs: number;
  httpRequestTimeoutMs: number;
  identityGrpcDeadlineMs: number;
  identityGrpcUrl: string;
  port: number;
  publicApiUrl: string;
  rateLimitKeySecret: string;
  redisConnectTimeoutMs: number;
  redisOperationTimeoutMs: number;
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

function readPositiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
): number {
  const value = Number(readRequiredString(environment, name));

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
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

  const publicApiUrl = readRequiredString(environment, 'PUBLIC_API_URL');
  let parsedPublicApiUrl: URL;

  try {
    parsedPublicApiUrl = new URL(publicApiUrl);
  } catch {
    throw new Error('PUBLIC_API_URL must be a valid HTTP or HTTPS URL');
  }

  if (!['http:', 'https:'].includes(parsedPublicApiUrl.protocol)) {
    throw new Error('PUBLIC_API_URL must be a valid HTTP or HTTPS URL');
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

  const httpHeadersTimeoutMs = readPositiveInteger(
    environment,
    'HTTP_HEADERS_TIMEOUT_MS',
  );
  const httpRequestTimeoutMs = readPositiveInteger(
    environment,
    'HTTP_REQUEST_TIMEOUT_MS',
  );

  if (httpHeadersTimeoutMs > httpRequestTimeoutMs) {
    throw new Error(
      'HTTP_HEADERS_TIMEOUT_MS must not exceed HTTP_REQUEST_TIMEOUT_MS',
    );
  }

  return {
    apiDocsEnabled: readBoolean(environment, 'API_DOCS_ENABLED'),
    httpHeadersTimeoutMs,
    httpKeepAliveTimeoutMs: readPositiveInteger(
      environment,
      'HTTP_KEEP_ALIVE_TIMEOUT_MS',
    ),
    httpRequestTimeoutMs,
    identityGrpcDeadlineMs: readPositiveInteger(
      environment,
      'IDENTITY_GRPC_DEADLINE_MS',
    ),
    identityGrpcUrl,
    port,
    publicApiUrl: parsedPublicApiUrl.toString().replace(/\/$/, ''),
    rateLimitKeySecret,
    redisConnectTimeoutMs: readPositiveInteger(
      environment,
      'REDIS_CONNECT_TIMEOUT_MS',
    ),
    redisOperationTimeoutMs: readPositiveInteger(
      environment,
      'REDIS_OPERATION_TIMEOUT_MS',
    ),
    redisUrl,
    trustProxyHops,
  };
}
