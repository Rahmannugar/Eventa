export interface RuntimeConfig {
  databaseUrl: string;
  grpcHost: string;
  grpcPort: number;
  healthPort: number;
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

export function readRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): RuntimeConfig {
  return {
    databaseUrl: readDatabaseUrl(environment),
    grpcHost: readRequiredString(environment, 'GRPC_HOST'),
    grpcPort: readPort(environment, 'GRPC_PORT'),
    healthPort: readPort(environment, 'HEALTH_PORT'),
  };
}
