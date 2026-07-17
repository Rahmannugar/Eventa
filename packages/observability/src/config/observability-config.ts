export interface ObservabilityConfig {
  deploymentEnvironment: string;
  otlpEndpoint: string;
  serviceName: string;
  serviceVersion: string;
}

interface ObservabilityIdentity {
  serviceName: string;
  serviceVersion: string;
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

export function readObservabilityConfig(
  environment: NodeJS.ProcessEnv,
  identity: ObservabilityIdentity,
): ObservabilityConfig {
  const otlpEndpoint = readRequiredString(
    environment,
    'OTEL_EXPORTER_OTLP_ENDPOINT',
  );

  let parsedEndpoint: URL;

  try {
    parsedEndpoint = new URL(otlpEndpoint);
  } catch {
    throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT must be a valid URL');
  }

  if (!['http:', 'https:'].includes(parsedEndpoint.protocol)) {
    throw new Error('OTEL_EXPORTER_OTLP_ENDPOINT must use http:// or https://');
  }

  return {
    deploymentEnvironment: readRequiredString(
      environment,
      'DEPLOYMENT_ENVIRONMENT',
    ),
    otlpEndpoint: parsedEndpoint.toString().replace(/\/$/, ''),
    serviceName: identity.serviceName,
    serviceVersion: identity.serviceVersion,
  };
}
