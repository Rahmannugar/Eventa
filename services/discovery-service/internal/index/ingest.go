package index

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/discovery-service/internal/logging"
	"github.com/eventa/discovery-service/internal/metrics"
	"github.com/eventa/discovery-service/internal/semantic"
)

// ErrContentUnavailable means Event Service no longer serves a published
// event, which happens when the event was cancelled between publication and
// this consumer. The fact is still applied; only its content is absent.
var ErrContentUnavailable = errors.New("event content unavailable")

// ErrFactRejected means a record claimed to be a lifecycle fact but broke its
// contract. Its offset is never advanced, so a corrected producer redelivers.
var ErrFactRejected = errors.New("lifecycle fact rejected")

// Outcome is the result of applying one lifecycle fact.
type Outcome string

const (
	OutcomeProcessed          Outcome = "processed"
	OutcomeContentUnavailable Outcome = "content_unavailable"
	OutcomeDuplicate          Outcome = "duplicate"
	OutcomeIgnored            Outcome = "ignored"
	OutcomeRejected           Outcome = "rejected"
)

// Resolver reads authoritative content for one published event. It is the only
// way Discovery learns what an event contains.
type Resolver interface {
	GetPublishedContent(ctx context.Context, eventID string) (*Content, error)
}

// Syncer converges one event's semantic state with this index after the
// transaction commits. It is best effort here: a failure is recovered by the
// reconciler rather than by redelivering a fact that already committed.
type Syncer interface {
	Sync(ctx context.Context, eventID string) error
}

// Ingest applies one lifecycle fact to the Discovery-owned index.
type Ingest struct {
	repository *Repository
	resolver   Resolver
	syncer     Syncer
	logger     *slog.Logger
}

func NewIngest(pool *pgxpool.Pool, resolver Resolver, syncer Syncer) *Ingest {
	return &Ingest{
		repository: NewRepository(pool),
		resolver:   resolver,
		syncer:     syncer,
		logger:     logging.New("EventLifecycleConsumer"),
	}
}

// Ingest classifies one record, claims it in the durable inbox, resolves the
// content Event Service owns, and writes the index row — all in one
// transaction. A returned error leaves the offset alone so the record is
// redelivered after the restart backoff.
func (s *Ingest) Ingest(ctx context.Context, value []byte) (Outcome, error) {
	startedAt := time.Now()

	kind, fact, foreignType := ParseFact(value)
	switch kind {
	case ParseForeign:
		s.logger.InfoContext(ctx, "event_lifecycle_fact_ignored",
			"operation", Operation, "outcome", OutcomeIgnored, "fact_type", foreignType)
		s.record(OutcomeIgnored, startedAt, false)
		return OutcomeIgnored, nil
	case ParseRejected:
		s.logger.ErrorContext(ctx, "event_lifecycle_fact_rejected",
			"operation", Operation, "outcome", OutcomeRejected, "error_type", "fact_contract_violation")
		s.record(OutcomeRejected, startedAt, false)
		return OutcomeRejected, ErrFactRejected
	}

	outcome, err := s.apply(ctx, fact, kind, startedAt)
	if err != nil {
		return outcome, err
	}
	return outcome, nil
}

func (s *Ingest) apply(ctx context.Context, fact Fact, kind ParseKind, startedAt time.Time) (Outcome, error) {
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
		s.logger.InfoContext(ctx, "event_index_duplicate",
			"operation", Operation, "outcome", OutcomeDuplicate,
			"event_id", fact.EventID, "event_type", fact.Type)
		s.record(OutcomeDuplicate, startedAt, true)
		return OutcomeDuplicate, nil
	}

	outcome := OutcomeProcessed
	var content *Content
	if kind == ParsePublished {
		content, err = s.resolver.GetPublishedContent(ctx, fact.EventID)
		if errors.Is(err, ErrContentUnavailable) {
			content, outcome, err = nil, OutcomeContentUnavailable, nil
		}
		if err != nil {
			return "", fmt.Errorf("resolve event content: %w", err)
		}
	}

	if kind == ParsePublished {
		err = indexPublished(ctx, tx, fact, content)
	} else {
		err = markCancelled(ctx, tx, fact)
	}
	if err != nil {
		return "", err
	}

	// The obligation to embed or remove the event commits with the index row,
	// so a crash between the two leaves recoverable work instead of silence.
	var text string
	if kind == ParsePublished && content != nil {
		text = semantic.Truncate(semantic.BuildText(
			content.Title, content.Description, content.Categories,
			content.VenueName, content.VenueCity))
		err = semantic.RecordPendingIndex(ctx, tx, fact.EventID, semantic.Hash(text))
	} else if kind == ParseCancelled {
		err = semantic.RecordPendingRemoval(ctx, tx, fact.EventID)
	}
	if err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit lifecycle fact: %w", err)
	}

	switch outcome {
	case OutcomeContentUnavailable:
		s.logger.WarnContext(ctx, "event_index_content_unavailable",
			"operation", Operation, "outcome", outcome,
			"event_id", fact.EventID, "event_type", fact.Type)
	default:
		s.logger.InfoContext(ctx, "event_indexed",
			"operation", Operation, "outcome", outcome,
			"event_id", fact.EventID, "event_type", fact.Type, "status", statusFor(kind))
	}
	s.record(outcome, startedAt, true)

	if s.syncer != nil && (text != "" || kind == ParseCancelled) {
		if err := s.syncer.Sync(ctx, fact.EventID); err != nil {
			s.logger.WarnContext(ctx, "semantic_sync_deferred",
				"operation", Operation, "event_id", fact.EventID,
				"error_type", semantic.ErrorClass(err))
		}
	}
	return outcome, nil
}

// record publishes the throughput signal for this consumer and, for the
// results that carry business meaning, the business outcome as well.
func (s *Ingest) record(outcome Outcome, startedAt time.Time, business bool) {
	metrics.RecordJob(time.Since(startedAt), Operation, string(outcome))
	if business {
		metrics.RecordBusinessOutcome(Operation, string(outcome))
	}
}

func statusFor(kind ParseKind) string {
	if kind == ParseCancelled {
		return "cancelled"
	}
	return "published"
}
