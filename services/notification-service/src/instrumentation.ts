import { readObservabilityConfig, startTelemetry } from '@eventa/observability';

startTelemetry(
  readObservabilityConfig(process.env, {
    serviceName: 'eventa-notification-service',
    serviceVersion: '0.0.0',
  }),
);
