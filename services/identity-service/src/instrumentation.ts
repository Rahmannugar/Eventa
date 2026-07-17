import { readObservabilityConfig, startTelemetry } from '@eventa/observability';

startTelemetry(
  readObservabilityConfig(process.env, {
    serviceName: 'eventa-identity-service',
    serviceVersion: '0.0.0',
  }),
);
