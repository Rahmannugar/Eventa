package unittest

import (
	"context"
	"errors"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/eventa/notification-service/internal/telemetry"
)

// An unended span is never handed to the exporter, so a service that records
// status without ending the span silently exports no traces at all.
func TestEndSpanExportsTheSpan(t *testing.T) {
	exporter, restore := useTestTracer(t)
	defer restore()

	_, span := telemetry.StartSpan(context.Background(), "unit.span", trace.SpanKindInternal)
	telemetry.EndSpan(span, nil)

	spans := exporter.GetSpans()
	if len(spans) != 1 {
		t.Fatalf("expected one exported span, got %d", len(spans))
	}
	if got := spans[0].Name; got != "unit.span" {
		t.Errorf("span name = %q, want %q", got, "unit.span")
	}
	if got := spans[0].Status.Code; got != codes.Ok {
		t.Errorf("status = %v, want %v", got, codes.Ok)
	}
}

func TestEndSpanRecordsTheFailureAndItsType(t *testing.T) {
	exporter, restore := useTestTracer(t)
	defer restore()

	_, span := telemetry.StartSpan(context.Background(), "unit.span", trace.SpanKindInternal)
	telemetry.EndSpan(span, errors.New("boom"))

	spans := exporter.GetSpans()
	if len(spans) != 1 {
		t.Fatalf("expected one exported span, got %d", len(spans))
	}
	if got := spans[0].Status.Code; got != codes.Error {
		t.Errorf("status = %v, want %v", got, codes.Error)
	}
	if got := attributeValue(spans[0].Attributes, "error.type"); got != "*errors.errorString" {
		t.Errorf("error.type = %q, want %q", got, "*errors.errorString")
	}
}

func useTestTracer(t *testing.T) (*tracetest.InMemoryExporter, func()) {
	t.Helper()
	exporter := tracetest.NewInMemoryExporter()
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(
		sdktrace.WithSyncer(exporter),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	))
	return exporter, func() { otel.SetTracerProvider(previous) }
}

func attributeValue(attributes []attribute.KeyValue, key attribute.Key) string {
	for _, candidate := range attributes {
		if candidate.Key == key {
			return candidate.Value.AsString()
		}
	}
	return ""
}
