// Package metrics publishes the job instruments the TypeScript service records
// through @eventa/observability, under the same meter name so the Prometheus
// series line up.
package metrics

import (
	"context"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

const meterName = "@eventa/observability"

var (
	jobCount    metric.Int64Counter
	jobDuration metric.Float64Histogram
	jobInFlight metric.Int64UpDownCounter
)

// Init creates the job instruments. It is best effort: a failure leaves the
// instruments unset, and every recording becomes a no-op, matching the
// optional instrumentation the TypeScript service records.
func Init() error {
	meter := otel.Meter(meterName)

	counter, err := meter.Int64Counter(
		"eventa.job.count",
		metric.WithDescription("Completed jobs grouped by bounded operation and outcome"),
	)
	if err != nil {
		return err
	}

	histogram, err := meter.Float64Histogram(
		"eventa.job.duration",
		metric.WithDescription("Job processing duration from broker delivery to completion"),
		metric.WithUnit("ms"),
		metric.WithExplicitBucketBoundaries(10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000),
	)
	if err != nil {
		return err
	}

	inFlight, err := meter.Int64UpDownCounter(
		"eventa.job.in_flight",
		metric.WithDescription("Jobs actively held by a worker"),
	)
	if err != nil {
		return err
	}

	jobCount, jobDuration, jobInFlight = counter, histogram, inFlight
	return nil
}

// RecordJob counts one completed job and records how long it took from
// broker delivery to completion.
func RecordJob(elapsed time.Duration, operation, outcome string) {
	if jobCount == nil || jobDuration == nil {
		return
	}
	attributes := metric.WithAttributes(
		attribute.String("operation", operation),
		attribute.String("outcome", outcome),
	)
	jobCount.Add(context.Background(), 1, attributes)
	jobDuration.Record(context.Background(), float64(elapsed)/float64(time.Millisecond), attributes)
}

// AddJobInFlight moves the active-job gauge by delta, which is 1 or -1.
func AddJobInFlight(delta int64, operation string) {
	if jobInFlight == nil {
		return
	}
	jobInFlight.Add(context.Background(), delta,
		metric.WithAttributes(attribute.String("operation", operation)))
}
