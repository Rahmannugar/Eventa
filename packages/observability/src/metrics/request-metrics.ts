import {
  metrics,
  type Attributes,
  type Counter,
  type Histogram,
} from '@opentelemetry/api';

export interface RequestMetricAttributes {
  operation: string;
  outcome: 'client_error' | 'server_error' | 'success';
  statusCode: string;
  transport: 'grpc' | 'http';
}

export interface BusinessOutcomeAttributes {
  operation: string;
  outcome: string;
}

let requestCount: Counter | undefined;
let requestDuration: Histogram | undefined;
let businessOutcomeCount: Counter | undefined;

export function initializeMetrics(): void {
  if (
    requestCount !== undefined ||
    requestDuration !== undefined ||
    businessOutcomeCount !== undefined
  ) {
    return;
  }

  const meter = metrics.getMeter('@eventa/observability');
  meter
    .createObservableGauge('eventa.service.instance', {
      description:
        'Reports one while a service instance is exporting telemetry',
    })
    .addCallback((result) => result.observe(1));
  requestCount = meter.createCounter('eventa.request.count', {
    description: 'Completed requests grouped by bounded operation and outcome',
  });
  requestDuration = meter.createHistogram('eventa.request.duration', {
    advice: {
      explicitBucketBoundaries: [
        5, 10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1_000, 1_250,
        1_500, 2_000, 2_500, 5_000, 7_500, 10_000,
      ],
    },
    description: 'Completed request duration',
    unit: 'ms',
  });
  businessOutcomeCount = meter.createCounter('eventa.business.outcome.count', {
    description: 'Completed business-operation outcomes',
  });
}

export function recordRequestMetrics(
  durationMilliseconds: number,
  attributes: RequestMetricAttributes,
): void {
  const metricAttributes: Attributes = { ...attributes };
  requestCount?.add(1, metricAttributes);
  requestDuration?.record(durationMilliseconds, metricAttributes);
}

export function recordBusinessOutcome(
  attributes: BusinessOutcomeAttributes,
): void {
  businessOutcomeCount?.add(1, { ...attributes });
}
