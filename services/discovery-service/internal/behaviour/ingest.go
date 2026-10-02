package behaviour

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/discovery-service/internal/logging"
	"github.com/eventa/discovery-service/internal/metrics"
)

// ErrFactRejected means a record claimed to be a behavioural fact but broke
// its contract. Its offset is never advanced, so a corrected producer
// redelivers it.
var ErrFactRejected = errors.New("behaviour fact rejected")

// Outcome is the result of applying one behavioural fact.
type Outcome string

const (
	OutcomeProcessed Outcome = "processed"
	OutcomeDuplicate Outcome = "duplicate"
	OutcomeIgnored   Outcome = "ignored"
	OutcomeRejected  Outcome = "rejected"
)

// Ingest applies one behavioural fact to the Discovery-owned evidence tables.
type Ingest struct {
	repository *Repository
	logger     *slog.Logger
}

// NewIngest binds the evidence tables to the service logger.
func NewIngest(pool *pgxpool.Pool) *Ingest {
	return &Ingest{
		repository: NewRepository(pool),
		logger:     logging.New("BehaviourConsumer"),
	}
}

// Ingest classifies one record, claims it in the durable inbox, and upserts
// the evidence row — all in one transaction. A returned error leaves the
// offset alone so the record is redelivered after the restart backoff.
func (s *Ingest) Ingest(ctx context.Context, value []byte) (Outcome, error) {
	startedAt := time.Now()

	kind, fact, foreignType := ParseFact(value)
	switch kind {
	case ParseForeign:
		s.logger.InfoContext(ctx, "behaviour_fact_ignored",
			"operation", Operation, "outcome", OutcomeIgnored, "fact_type", foreignType)
		s.record(OutcomeIgnored, startedAt, false)
		return OutcomeIgnored, nil
	case ParseRejected:
		s.logger.ErrorContext(ctx, "behaviour_fact_rejected",
			"operation", Operation, "outcome", OutcomeRejected, "error_type", "fact_contract_violation")
		s.record(OutcomeRejected, startedAt, false)
		return OutcomeRejected, ErrFactRejected
	}

	return s.apply(ctx, fact, startedAt)
}

func (s *Ingest) apply(ctx context.Context, fact Fact, startedAt time.Time) (Outcome, error) {
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
		// Every path commits: a replayed fact is durable knowledge that it
		// was already applied, not a partial write to discard.
		if err := tx.Commit(ctx); err != nil {
			return "", fmt.Errorf("commit duplicate claim: %w", err)
		}
		s.logger.InfoContext(ctx, "attendee_behaviour_duplicate",
			"operation", Operation, "outcome", OutcomeDuplicate,
			"event_id", fact.EventID, "fact_type", fact.Type, "kind", string(fact.Kind))
		s.record(OutcomeDuplicate, startedAt, true)
		return OutcomeDuplicate, nil
	}

	if err := recordEvidence(ctx, tx, fact); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit behaviour fact: %w", err)
	}

	s.logger.InfoContext(ctx, "attendee_behaviour_recorded",
		"operation", Operation, "outcome", OutcomeProcessed,
		"event_id", fact.EventID, "fact_type", fact.Type, "kind", string(fact.Kind))
	s.record(OutcomeProcessed, startedAt, true)
	return OutcomeProcessed, nil
}

// record publishes the throughput signal for this consumer and, for the
// results that carry business meaning, the business outcome as well.
func (s *Ingest) record(outcome Outcome, startedAt time.Time, business bool) {
	metrics.RecordJob(time.Since(startedAt), Operation, string(outcome))
	if business {
		metrics.RecordBusinessOutcome(Operation, string(outcome))
	}
}
