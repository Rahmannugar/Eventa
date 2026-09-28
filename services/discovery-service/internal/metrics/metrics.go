// Package metrics publishes the job and request instruments the TypeScript
// service records through @eventa/observability, under the same meter name so
// the Prometheus series line up.
package metrics

import (
	"context"
	"strconv"
	"sync/atomic"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

const meterName = "@eventa/observability"

var (
	jobCount        metric.Int64Counter
	jobDuration     metric.Float64Histogram
	jobInFlight     metric.Int64UpDownCounter
	businessOutcome metric.Int64Counter
	requestCount    metric.Int64Counter
	requestDuration metric.Float64Histogram
	semanticOp      metric.Int64Counter
	semanticCanary  metric.Int64Counter
	semanticPending atomic.Int64
)

// Init creates the job instruments. It is best effort: a failure leaves the
// instruments unset, and every recording becomes a no-op, matching the
// optional instrumentation the TypeScript service records.
func Init() error {
	meter := otel.Meter(meterName)

	instance, err := meter.Int64ObservableGauge(
		"eventa.service.instance",
		metric.WithDescription("Reports one while a service instance is exporting telemetry"),
	)
	if err != nil {
		return err
	}
	if _, err := meter.RegisterCallback(
		func(_ context.Context, observer metric.Observer) error {
			observer.ObserveInt64(instance, 1)
			return nil
		},
		instance,
	); err != nil {
		return err
	}

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

	outcomeCounter, err := meter.Int64Counter(
		"eventa.business.outcome.count",
		metric.WithDescription("Business outcomes grouped by bounded operation and outcome"),
	)
	if err != nil {
		return err
	}

	httpCount, err := meter.Int64Counter(
		"eventa.request.count",
		metric.WithDescription("HTTP requests grouped by route, outcome, status code, and transport"),
	)
	if err != nil {
		return err
	}

	httpDuration, err := meter.Float64Histogram(
		"eventa.request.duration",
		metric.WithDescription("HTTP request duration"),
		metric.WithUnit("ms"),
		metric.WithExplicitBucketBoundaries(5, 10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000, 1250, 1500, 2000, 2500, 5000, 7500, 10000),
	)
	if err != nil {
		return err
	}

	semanticCount, err := meter.Int64Counter(
		"eventa.semantic.operation.count",
		metric.WithDescription("Semantic index operations grouped by outcome"),
	)
	if err != nil {
		return err
	}

	canaryCount, err := meter.Int64Counter(
		"eventa.semantic.canary.count",
		metric.WithDescription("Synthetic similarity probes grouped by outcome"),
	)
	if err != nil {
		return err
	}

	pendingGauge, err := meter.Int64ObservableGauge(
		"eventa.semantic.pending",
		metric.WithDescription("Events whose projection and semantic store state disagree"),
	)
	if err != nil {
		return err
	}
	if _, err := meter.RegisterCallback(
		func(_ context.Context, observer metric.Observer) error {
			observer.ObserveInt64(pendingGauge, semanticPending.Load())
			return nil
		},
		pendingGauge,
	); err != nil {
		return err
	}

	jobCount, jobDuration, jobInFlight, businessOutcome = counter, histogram, inFlight, outcomeCounter
	requestCount, requestDuration = httpCount, httpDuration
	semanticOp, semanticCanary = semanticCount, canaryCount
	return nil
}

// RecordSemanticOperation counts one semantic index attempt and its bounded
// outcome. Outcomes are classes such as `indexed`, `removed`, and
// `failed_deadline_exceeded`; they never carry a payload or a query.
func RecordSemanticOperation(operation, outcome string) {
	if semanticOp == nil {
		return
	}
	semanticOp.Add(context.Background(), 1,
		metric.WithAttributes(
			attribute.String("operation", operation),
			attribute.String("outcome", outcome),
		))
}

// RecordSemanticCanary counts one synthetic query against the store. `ok`,
// `empty`, `below_floor`, and `failed` are the only outcomes.
func RecordSemanticCanary(outcome string) {
	if semanticCanary == nil {
		return
	}
	semanticCanary.Add(context.Background(), 1,
		metric.WithAttributes(attribute.String("outcome", outcome)))
}

// SetSemanticPending publishes how many events still disagree with the store.
func SetSemanticPending(count int64) { semanticPending.Store(count) }

// RecordBusinessOutcome counts one business result, which is distinct from the
// broker job that carried it: the same job can succeed while its business
// result is a duplicate.
func RecordBusinessOutcome(operation, outcome string) {
	if businessOutcome == nil {
		return
	}
	businessOutcome.Add(context.Background(), 1,
		metric.WithAttributes(
			attribute.String("operation", operation),
			attribute.String("outcome", outcome),
		))
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

// RequestOutcome classes a status code exactly as @eventa/observability does:
// 5xx and above are a server failure, 4xx is the caller's fault, and anything
// lower is a success.
func RequestOutcome(statusCode int) string {
	switch {
	case statusCode >= 500:
		return "server_error"
	case statusCode >= 400:
		return "client_error"
	default:
		return "success"
	}
}

// RecordRequest counts one request and records how long it took. transport
// names the listener that carried it: the health server reports `http` and
// the query API reports `grpc`.
func RecordRequest(elapsed time.Duration, operation, outcome string, statusCode int, transport string) {
	if requestCount == nil || requestDuration == nil {
		return
	}
	attributes := metric.WithAttributes(
		attribute.String("operation", operation),
		attribute.String("outcome", outcome),
		attribute.String("statusCode", strconv.Itoa(statusCode)),
		attribute.String("transport", transport),
	)
	requestCount.Add(context.Background(), 1, attributes)
	requestDuration.Record(context.Background(), float64(elapsed)/float64(time.Millisecond), attributes)
}
