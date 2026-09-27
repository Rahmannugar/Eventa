package telemetry

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

const (
	serviceName    = "eventa-notification-service"
	serviceVersion = "0.0.0"
	exportInterval = 10 * time.Second
)

// Start installs the SDK providers and returns a shutdown that flushes traces
// and the final metric batch before the process exits.
func Start(ctx context.Context, endpoint, deploymentEnvironment string) (func(context.Context) error, error) {
	traceExporter, err := otlptracehttp.New(ctx, otlptracehttp.WithEndpointURL(endpoint+"/v1/traces"))
	if err != nil {
		return nil, fmt.Errorf("create trace exporter: %w", err)
	}
	metricExporter, err := otlpmetrichttp.New(ctx, otlpmetrichttp.WithEndpointURL(endpoint+"/v1/metrics"))
	if err != nil {
		return nil, fmt.Errorf("create metric exporter: %w", err)
	}

	res, err := resource.Merge(resource.Default(), resource.NewWithAttributes("",
		attribute.String("service.name", serviceName),
		attribute.String("service.namespace", "eventa"),
		attribute.String("service.version", serviceVersion),
		attribute.String("service.instance.id", uuid.NewString()),
		attribute.String("deployment.environment.name", deploymentEnvironment),
	))
	if err != nil {
		return nil, fmt.Errorf("build resource: %w", err)
	}

	tracerProvider := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(traceExporter),
		sdktrace.WithResource(res),
	)
	meterProvider := metric.NewMeterProvider(
		metric.WithResource(res),
		metric.WithReader(metric.NewPeriodicReader(metricExporter, metric.WithInterval(exportInterval))),
	)

	otel.SetTracerProvider(tracerProvider)
	otel.SetMeterProvider(meterProvider)
	// Broker headers are the only carrier between the publisher of a job and
	// the worker that finishes it, so the W3C fields must be read on the way in
	// and written on the way out.
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	return func(shutdownCtx context.Context) error {
		var firstErr error
		if err := tracerProvider.Shutdown(shutdownCtx); err != nil {
			firstErr = err
		}
		if err := meterProvider.Shutdown(shutdownCtx); err != nil && firstErr == nil {
			firstErr = err
		}
		return firstErr
	}, nil
}
