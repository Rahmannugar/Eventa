package cancellation

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"go.opentelemetry.io/otel/trace"

	"github.com/eventa/notification-service/internal/logging"
	"github.com/eventa/notification-service/internal/metrics"
	"github.com/eventa/notification-service/internal/telemetry"
)

// ErrFactRejected is returned for a record this service cannot read. The offset
// is deliberately not committed, so the record is redelivered after the restart
// backoff; there is no terminal disposition for a permanently malformed fact.
var ErrFactRejected = errors.New("TICKET_REVOKED_FACT_REJECTED")

// FactHandler turns one Kafka record into durable cancellation work.
type FactHandler struct {
	ingest *Ingest
	topic  string
	logger *slog.Logger
}

// NewFactHandler wires the handler for one topic.
func NewFactHandler(ingest *Ingest, topic string) *FactHandler {
	return &FactHandler{
		ingest: ingest,
		topic:  topic,
		logger: logging.New(FactConsumerContext),
	}
}

// Handle processes one record. Returning nil commits its offset; anything else
// leaves the offset alone.
func (h *FactHandler) Handle(ctx context.Context, _ map[string]any, value []byte) error {
	startedAt := time.Now()
	metrics.AddJobInFlight(1, Operation)
	defer metrics.AddJobInFlight(-1, Operation)

	kind, fact, foreignType := ParseFact(value)
	switch kind {
	case ParseForeign:
		h.logger.InfoContext(ctx, "ticket_revocation_fact_ignored",
			"event_type", foreignType,
			"operation", Operation)
		metrics.RecordJob(time.Since(startedAt), Operation, "ignored")
		return nil
	case ParseRejected:
		h.logger.ErrorContext(ctx, "ticket_revocation_fact_rejected", "operation", Operation)
		metrics.RecordJob(time.Since(startedAt), Operation, "rejected")
		return ErrFactRejected
	}

	spanContext, span := telemetry.StartSpan(ctx, "ticket_revocation_fact.process", trace.SpanKindConsumer,
		telemetry.MessagingAttributes(h.topic, "process", "kafka")...)
	outcome, err := h.ingest.HandleRevocation(spanContext, fact)
	telemetry.EndSpan(span, err)
	if err != nil {
		return err
	}

	metrics.RecordJob(time.Since(startedAt), Operation, outcome)
	return nil
}
