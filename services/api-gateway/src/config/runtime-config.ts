export interface RuntimeConfig {
  port: number;
}

export function readRuntimeConfig(
  environment: NodeJS.ProcessEnv,
): RuntimeConfig {
  const rawPort = environment.PORT;

  if (rawPort === undefined) {
    throw new Error('PORT is required');
  }

  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  return { port };
}
