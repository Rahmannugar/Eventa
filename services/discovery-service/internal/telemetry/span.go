package telemetry

import (
	"context"

	"github.com/eventa/discovery-service/internal/errtype"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

// MessagingAttributes are the semconv fields every broker span carries.
func MessagingAttributes(destination, operation, system string) []attribute.KeyValue {
	return []attribute.KeyValue{
		attribute.String("messaging.destination.name", destination),
		attribute.String("messaging.operation.name", operation),
		attribute.String("messaging.system", system),
	}
}

// StartSpan opens a span under ctx and returns the context to work in.
func StartSpan(ctx context.Context, name string, kind trace.SpanKind, attributes ...attribute.KeyValue) (context.Context, trace.Span) {
	return otel.Tracer(meterName).Start(ctx, name,
		trace.WithSpanKind(kind),
		trace.WithAttributes(attributes...),
	)
}

// EndSpan records the outcome: OK on success, ERROR plus error.type on failure,
// then ends the span so the batch processor can export it.
func EndSpan(span trace.Span, err error) {
	defer span.End()
	if err != nil {
		span.SetStatus(codes.Error, "")
		span.SetAttributes(attribute.String("error.type", errtype.Of(err)))
		return
	}
	span.SetStatus(codes.Ok, "")
}

// meterName is the tracer name @eventa/observability uses, so spans land in
// the same trace hierarchy the TypeScript service produced.
const meterName = "@eventa/observability"

// AMQPHeaderCarrier carries trace context across AMQP message headers.
type AMQPHeaderCarrier struct {
	Headers map[string]any
}

var _ propagation.TextMapCarrier = AMQPHeaderCarrier{}

func (c AMQPHeaderCarrier) Get(key string) string {
	if c.Headers == nil {
		return ""
	}
	switch value := c.Headers[key].(type) {
	case string:
		return value
	case []byte:
		return string(value)
	default:
		return ""
	}
}

func (c AMQPHeaderCarrier) Set(key, value string) {
	if c.Headers == nil {
		c.Headers = map[string]any{}
	}
	c.Headers[key] = value
}

func (c AMQPHeaderCarrier) Keys() []string {
	keys := make([]string, 0, len(c.Headers))
	for key := range c.Headers {
		keys = append(keys, key)
	}
	return keys
}

// ExtractHeaders reads traceparent, tracestate and baggage from broker headers
// and returns a context parented by them.
func ExtractHeaders(ctx context.Context, headers map[string]any) context.Context {
	return otel.GetTextMapPropagator().Extract(ctx, AMQPHeaderCarrier{Headers: headers})
}
