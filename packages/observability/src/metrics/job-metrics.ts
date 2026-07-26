import {
  metrics,
  type Attributes,
  type Counter,
  type Histogram,
  type UpDownCounter,
} from '@opentelemetry/api';

export interface JobMetricAttributes {
  operation: string;
  outcome: string;
}

export interface JobInFlightAttributes {
  operation: string;
}

let jobCount: Counter | undefined;
let jobDuration: Histogram | undefined;
let jobInFlight: UpDownCounter | undefined;

export function initializeJobMetrics(): void {
  if (
    jobCount !== undefined ||
    jobDuration !== undefined ||
    jobInFlight !== undefined
  ) {
    return;
  }

  const meter = metrics.getMeter('@eventa/observability');
  jobCount = meter.createCounter('eventa.job.count', {
    description: 'Completed jobs grouped by bounded operation and outcome',
  });
  jobDuration = meter.createHistogram('eventa.job.duration', {
    advice: {
      explicitBucketBoundaries: [
        10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 30_000,
      ],
    },
    description: 'Job processing duration from broker delivery to completion',
    unit: 'ms',
  });
  jobInFlight = meter.createUpDownCounter('eventa.job.in_flight', {
    description: 'Jobs actively held by a worker',
  });
}

export function recordJobMetrics(
  durationMilliseconds: number,
  attributes: JobMetricAttributes,
): void {
  const metricAttributes: Attributes = { ...attributes };
  jobCount?.add(1, metricAttributes);
  jobDuration?.record(durationMilliseconds, metricAttributes);
}

export function addJobInFlight(
  delta: 1 | -1,
  attributes: JobInFlightAttributes,
): void {
  jobInFlight?.add(delta, { ...attributes });
}
