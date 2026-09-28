package semantic

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/eventa/discovery-service/internal/logging"
	"github.com/eventa/discovery-service/internal/metrics"
)

// Indexer converges the derived store with the Discovery-owned projection. It
// is the single path the lifecycle consumer, the reconciler, and the reindex
// command all take, so there is one way an event reaches the store.
type Indexer struct {
	repository *Repository
	store      Store
	logger     *slog.Logger
}

func NewIndexer(repository *Repository, store Store) *Indexer {
	return &Indexer{
		repository: repository,
		store:      store,
		logger:     logging.New("SemanticIndexer"),
	}
}

// Sync brings one event's store state in line with the projection. It is
// idempotent: an already converged event costs one read and no store call.
func (i *Indexer) Sync(ctx context.Context, eventID string) error {
	return i.sync(ctx, eventID, false)
}

// Resync is Sync with the stored content hash ignored, used when a probe finds
// the store missing an event it claims to hold.
func (i *Indexer) Resync(ctx context.Context, eventID string) error {
	return i.sync(ctx, eventID, true)
}

func (i *Indexer) sync(ctx context.Context, eventID string, force bool) error {
	work, err := i.repository.GetWork(ctx, eventID)
	if err != nil {
		return err
	}
	if work == nil {
		return nil
	}

	if work.Desired == "remove" {
		if work.Actual == "removed" {
			return nil
		}
		if err := i.store.RemoveEvent(ctx, eventID); err != nil {
			return i.fail(ctx, eventID, err)
		}
		if err := i.repository.MarkRemoved(ctx, eventID); err != nil {
			return err
		}
		i.logger.InfoContext(ctx, "semantic_event_removed",
			"operation", Operation, "event_id", eventID)
		metrics.RecordSemanticOperation(Operation, "removed")
		return nil
	}

	if !work.HasText {
		if work.Actual == "removed" {
			return nil
		}
		if err := i.store.RemoveEvent(ctx, eventID); err != nil {
			return i.fail(ctx, eventID, err)
		}
		if err := i.repository.MarkRemoved(ctx, eventID); err != nil {
			return err
		}
		metrics.RecordSemanticOperation(Operation, "removed")
		return nil
	}

	text := Truncate(BuildText(work.Title, work.Desc, work.Categories, work.VenueName, work.VenueCity))
	hash := Hash(text)
	if !force && work.Actual == "indexed" && work.Hash == hash {
		return nil
	}

	if err := i.store.IndexEvent(ctx, eventID, text,
		Attribute{Key: EventAttributeKey, Value: eventID}); err != nil {
		return i.fail(ctx, eventID, err)
	}
	if err := i.repository.MarkIndexed(ctx, eventID, hash); err != nil {
		return err
	}
	i.logger.InfoContext(ctx, "semantic_event_indexed",
		"operation", Operation, "event_id", eventID)
	metrics.RecordSemanticOperation(Operation, "indexed")
	return nil
}

// fail keeps the row pending and publishes the bounded failure class. The
// caller decides whether to log; the reconciler retries until it converges.
func (i *Indexer) fail(ctx context.Context, eventID string, err error) error {
	class := ErrorClass(err)
	if recordErr := i.repository.RecordFailure(ctx, eventID, class); recordErr != nil {
		return fmt.Errorf("%v (recording failure: %w)", err, recordErr)
	}
	metrics.RecordSemanticOperation(Operation, "failed_"+class)
	return err
}

// Operation names the semantic work on metrics and log lines.
const Operation = "discovery.semantic"
