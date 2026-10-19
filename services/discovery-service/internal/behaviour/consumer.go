package behaviour

import (
	"context"

	"go.opentelemetry.io/otel/trace"

	"github.com/eventa/discovery-service/internal/messaging/kafka"
	"github.com/eventa/discovery-service/internal/telemetry"
)

// Handler adapts Ingest to the supervised consumer. Returning the parse
// failure for a rejected record is what leaves its offset uncommitted. The
// consumer span is what puts one fact's processing in Tempo: this path talks
// to no remote service, so without it the log line's trace id would resolve to
// nothing.
func (s *Ingest) Handler(topic string) kafka.Handler {
	return func(ctx context.Context, _ map[string]any, value []byte) error {
		spanContext, span := telemetry.StartSpan(ctx, "attendee_behaviour.process", trace.SpanKindConsumer,
			telemetry.MessagingAttributes(topic, "process", "kafka")...)
		_, err := s.Ingest(spanContext, value)
		telemetry.EndSpan(span, err)
		return err
	}
}
