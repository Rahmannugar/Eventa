import { describe, expect, it } from 'vitest';

import { readObservabilityConfig } from '../../src/config/observability-config';

const identity = {
  serviceName: 'eventa-test-service',
  serviceVersion: '0.0.0',
};

describe('readObservabilityConfig', () => {
  it('returns stable service identity and normalized OTLP configuration', () => {
    expect(
      readObservabilityConfig(
        {
          DEPLOYMENT_ENVIRONMENT: 'local',
          OTEL_EXPORTER_OTLP_ENDPOINT: 'http://observability-collector:4318/',
        },
        identity,
      ),
    ).toEqual({
      deploymentEnvironment: 'local',
      otlpEndpoint: 'http://observability-collector:4318',
      serviceName: 'eventa-test-service',
      serviceVersion: '0.0.0',
    });
  });

  it.each([
    [
      'DEPLOYMENT_ENVIRONMENT',
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' },
    ],
    ['OTEL_EXPORTER_OTLP_ENDPOINT', { DEPLOYMENT_ENVIRONMENT: 'local' }],
  ])('fails when %s is missing', (name, environment) => {
    expect(() => readObservabilityConfig(environment, identity)).toThrow(
      `${name} is required`,
    );
  });

  it('rejects OTLP endpoints that do not use HTTP transport', () => {
    expect(() =>
      readObservabilityConfig(
        {
          DEPLOYMENT_ENVIRONMENT: 'local',
          OTEL_EXPORTER_OTLP_ENDPOINT: 'grpc://collector:4317',
        },
        identity,
      ),
    ).toThrow('OTEL_EXPORTER_OTLP_ENDPOINT must use http:// or https://');
  });
});
