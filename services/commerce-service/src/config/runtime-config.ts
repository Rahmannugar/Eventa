export interface RuntimeConfig {
  databaseUrl: string;
  healthPort: number;
}

function readRequiredString(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.trim() === '') throw new Error(`${name} is required`);
  return value.trim();
}

export function readDatabaseUrl(environment: NodeJS.ProcessEnv): string {
  return readRequiredString(environment, 'DATABASE_URL');
}

export function readRuntimeConfig(environment: NodeJS.ProcessEnv): RuntimeConfig {
  const healthPort = Number(readRequiredString(environment, 'HEALTH_PORT'));
  if (!Number.isInteger(healthPort) || healthPort < 1 || healthPort > 65_535) {
    throw new Error('HEALTH_PORT must be an integer between 1 and 65535');
  }
  return { databaseUrl: readDatabaseUrl(environment), healthPort };
}
