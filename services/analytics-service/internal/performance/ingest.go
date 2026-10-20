package performance

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/analytics-service/internal/errtype"
	"github.com/eventa/analytics-service/internal/facts"
	"github.com/eventa/analytics-service/internal/logging"
	"github.com/eventa/analytics-service/internal/messaging/kafka"
	"github.com/eventa/analytics-service/internal/metrics"
)

// Operation is the bounded operation name every metric and log line for this
// path carries. It is the shared facts operation so one dashboard query sees
// every projection stream.
const Operation = facts.Operation

// ErrFactRejected means a record claimed to be a projected fact but broke its
// contract. Its offset is never advanced, so a corrected producer redelivers.
var ErrFactRejected = errors.New("performance fact rejected")

// KafkaClientIDs identify each consumer's connections to the broker. One per
// topic so a stalled stream never blocks its siblings.
const (
	KafkaCommerceClientID  = "eventa-analytics-commerce"
	KafkaCheckInClientID   = "eventa-analytics-check-in"
	KafkaRevokedClientID   = "eventa-analytics-revoked"
	KafkaLifecycleClientID = "eventa-analytics-lifecycle"
)

// Outcome is the result of applying one fact.
type Outcome string

const (
	OutcomeProcessed Outcome = "processed"
	OutcomeDuplicate Outcome = "duplicate"
	OutcomeIgnored   Outcome = "ignored"
	OutcomeRejected  Outcome = "rejected"
)

// Ingest applies one fact to the event performance projection.
type Ingest struct {
	repository *Repository
	logger     *slog.Logger
}

func NewIngest(pool *pgxpool.Pool) *Ingest {
	return &Ingest{
		repository: NewRepository(pool),
		logger:     logging.New("AnalyticsConsumer"),
	}
}

// Handler adapts Ingest to the supervised consumers. Returning the parse
// failure for a rejected record is what leaves its offset uncommitted.
func (s *Ingest) Handler() kafka.Handler {
	return func(ctx context.Context, _ map[string]any, value []byte) error {
		_, err := s.Ingest(ctx, value)
		return err
	}
}

// Ingest classifies one record, claims it in the durable inbox, and applies
// it to the projection row — all in one transaction. A returned error leaves
// the offset alone so the record is redelivered after the restart backoff.
func (s *Ingest) Ingest(ctx context.Context, value []byte) (Outcome, error) {
	startedAt := time.Now()

	kind, fact, foreignType := facts.Parse(value)
	switch kind {
	case facts.KindForeign:
		s.logger.InfoContext(ctx, "analytics_fact_ignored",
			"operation", facts.Operation, "outcome", OutcomeIgnored, "fact_type", foreignType)
		s.record(OutcomeIgnored, startedAt, false)
		return OutcomeIgnored, nil
	case facts.KindRejected:
		s.logger.ErrorContext(ctx, "analytics_fact_rejected",
			"operation", facts.Operation, "outcome", OutcomeRejected, "error_type", "fact_contract_violation")
		s.record(OutcomeRejected, startedAt, false)
		return OutcomeRejected, ErrFactRejected
	}

	outcome, err := s.apply(ctx, kind, fact, startedAt)
	if err != nil {
		s.logger.ErrorContext(ctx, "analytics_projection_failed",
			"operation", facts.Operation, "error_type", errtype.Of(err),
			"event_type", fact.Type, "event_id", fact.EventID)
		return outcome, err
	}
	return outcome, nil
}

func (s *Ingest) apply(ctx context.Context, kind facts.Kind, fact facts.Fact, startedAt time.Time) (Outcome, error) {
	tx, err := s.repository.begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	applied, err := claim(ctx, tx, fact)
	if err != nil {
		return "", err
	}
	if !applied {
		if err := tx.Commit(ctx); err != nil {
			return "", fmt.Errorf("commit duplicate claim: %w", err)
		}
		s.logger.InfoContext(ctx, "analytics_fact_duplicate",
			"operation", facts.Operation, "outcome", OutcomeDuplicate,
			"event_id", fact.EventID, "event_type", fact.Type)
		s.record(OutcomeDuplicate, startedAt, true)
		return OutcomeDuplicate, nil
	}

	if err := apply(ctx, tx, kind, fact); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit performance fact: %w", err)
	}

	s.logger.InfoContext(ctx, "analytics_fact_projected",
		"operation", facts.Operation, "outcome", OutcomeProcessed,
		"event_id", fact.EventID, "event_type", fact.Type)
	s.record(OutcomeProcessed, startedAt, true)
	return OutcomeProcessed, nil
}

func (s *Ingest) record(outcome Outcome, startedAt time.Time, business bool) {
	metrics.RecordJob(time.Since(startedAt), facts.Operation, string(outcome))
	if business {
		metrics.RecordBusinessOutcome(facts.Operation, string(outcome))
	}
}
