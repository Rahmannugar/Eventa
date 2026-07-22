import { randomUUID } from 'node:crypto';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

import type { ObservabilityConfig } from '../config/observability-config';
import { initializeMetrics } from '../metrics/request-metrics';

let telemetrySdk: NodeSDK | undefined;

export function startTelemetry(config: ObservabilityConfig): void {
  if (telemetrySdk !== undefined) {
    return;
  }

  telemetrySdk = new NodeSDK({
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-connect': { enabled: false },
        '@opentelemetry/instrumentation-express': { enabled: false },
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (request) =>
            request.url === '/health/live' || request.url === '/health/ready',
        },
        '@opentelemetry/instrumentation-nestjs-core': { enabled: false },
        '@opentelemetry/instrumentation-router': { enabled: false },
      }),
    ],
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${config.otlpEndpoint}/v1/metrics`,
      }),
      exportIntervalMillis: 10_000,
    }),
    resource: resourceFromAttributes({
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.deploymentEnvironment,
      [ATTR_SERVICE_INSTANCE_ID]: randomUUID(),
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_NAMESPACE]: 'eventa',
      [ATTR_SERVICE_VERSION]: config.serviceVersion,
    }),
    traceExporter: new OTLPTraceExporter({
      url: `${config.otlpEndpoint}/v1/traces`,
    }),
  });

  telemetrySdk.start();
  initializeMetrics();
}

export async function stopTelemetry(): Promise<void> {
  const sdk = telemetrySdk;
  telemetrySdk = undefined;

  await sdk?.shutdown();
}
