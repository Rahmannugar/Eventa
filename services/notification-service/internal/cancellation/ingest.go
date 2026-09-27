package cancellation

import (
	"context"
	"log/slog"

	"github.com/eventa/notification-service/internal/logging"
	"github.com/eventa/notification-service/internal/metrics"
)

// Ingest records a ticket revocation and reports its business outcome.
type Ingest struct {
	repository *Repository
	logger     *slog.Logger
}

// NewIngest wires the ingest path.
func NewIngest(repository *Repository) *Ingest {
	return &Ingest{repository: repository, logger: logging.New(IngestContext)}
}

// HandleRevocation writes the inbox, delivery and outbox rows and returns the
// job outcome: `processed` for new work, otherwise the record kind.
func (i *Ingest) HandleRevocation(ctx context.Context, fact Fact) (string, error) {
	record, err := i.repository.RecordRevocation(ctx, fact)
	if err != nil {
		return "", err
	}

	outcome := string(record.Kind)
	if record.Kind == RevocationCreated {
		outcome = "processed"
	}

	fields := []any{
		"event_id", fact.EventID,
		"message_id", fact.MessageID,
		"operation", Operation,
		"outcome", outcome,
	}
	switch record.Kind {
	case RevocationCreated:
		fields = append(fields, "delivery_id", record.DeliveryID)
		i.logger.InfoContext(ctx, EventPrefix+"_job_created", fields...)
	case RevocationGrouped:
		i.logger.InfoContext(ctx, EventPrefix+"_grouped", fields...)
	default:
		i.logger.InfoContext(ctx, EventPrefix+"_duplicate", fields...)
	}

	metrics.RecordBusinessOutcome(Operation, outcome)
	return outcome, nil
}
