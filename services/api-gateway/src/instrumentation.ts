import { readObservabilityConfig, startTelemetry } from '@eventa/observability';

startTelemetry(
  readObservabilityConfig(process.env, {
    serviceName: 'eventa-api-gateway',
    serviceVersion: '0.0.0',
  }),
);
