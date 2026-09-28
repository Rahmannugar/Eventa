package semantic

import (
	"context"
	"log/slog"
	"time"

	"github.com/eventa/discovery-service/internal/logging"
	"github.com/eventa/discovery-service/internal/metrics"
)

// CanaryText is the fixed query the reconciler sends through the embedding
// path. It exists to prove the whole chain — proxy, model, store, search —
// rather than to answer anything about a real event.
const CanaryText = "a local community event"

// Reconciler keeps the derived store converged with the projection and reports
// the drift it finds. It is the recovery owner for every row the store lost:
// Ahnlich keeps an interval snapshot without a write-ahead log, so a restart
// can silently drop data without any call having failed.
type Reconciler struct {
	indexer     *Indexer
	repository  *Repository
	store       Store
	batch       int
	canaryFloor float32
	logger      *slog.Logger
}

func NewReconciler(indexer *Indexer, repository *Repository, store Store, batch int, canaryFloor float32) *Reconciler {
	return &Reconciler{
		indexer:     indexer,
		repository:  repository,
		store:       store,
		batch:       batch,
		canaryFloor: canaryFloor,
		logger:      logging.New("SemanticReconciler"),
	}
}

// Run reconciles on a fixed interval until the context is cancelled. A pass
// that finds nothing is silent; a pass that repairs something reports it.
func (r *Reconciler) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.Pass(ctx)
		}
	}
}

// Pass performs one bounded cycle: make sure the store and its predicate exist,
// finish unfinished work, probe what the store claims to hold, run the canary,
// and publish the remaining drift.
func (r *Reconciler) Pass(ctx context.Context) {
	r.ensure(ctx)
	r.repair(ctx)
	r.probe(ctx)
	r.canary(ctx)

	pending, err := r.repository.PendingCount(ctx)
	if err != nil {
		r.logger.WarnContext(ctx, "semantic_pending_unavailable",
			"operation", Operation, "error_type", ErrorClass(err))
		return
	}
	metrics.SetSemanticPending(pending)
	if pending > 0 {
		r.logger.WarnContext(ctx, "semantic_reconciliation_pending",
			"operation", Operation, "pending", pending)
	}
}

// ensure repeats the idempotent store and predicate creation. The service can
// start before the proxy has finished loading its model, and without this the
// first failure would leave every later write failing until a restart.
func (r *Reconciler) ensure(ctx context.Context) {
	if err := r.store.EnsureStore(ctx); err != nil {
		r.logger.WarnContext(ctx, "semantic_store_unavailable",
			"operation", Operation, "error_type", ErrorClass(err))
	}
}

func (r *Reconciler) repair(ctx context.Context) {
	work, err := r.repository.ListWork(ctx, r.batch)
	if err != nil {
		r.logger.WarnContext(ctx, "semantic_reconciliation_unavailable",
			"operation", Operation, "error_type", ErrorClass(err))
		return
	}
	for _, item := range work {
		if err := r.indexer.Sync(ctx, item.EventID); err != nil {
			r.logger.WarnContext(ctx, "semantic_event_sync_failed",
				"operation", Operation, "event_id", item.EventID,
				"error_type", ErrorClass(err))
		}
	}
}

// probe confirms the store still holds what it claims to. Without it, a store
// that silently dropped rows after a restart looks healthy forever.
func (r *Reconciler) probe(ctx context.Context) {
	ids, err := r.repository.ProbeSample(ctx, r.batch)
	if err != nil {
		r.logger.WarnContext(ctx, "semantic_probe_unavailable",
			"operation", Operation, "error_type", ErrorClass(err))
		return
	}
	for _, eventID := range ids {
		present, err := r.store.Contains(ctx, eventID)
		if err != nil {
			r.logger.WarnContext(ctx, "semantic_probe_failed",
				"operation", Operation, "event_id", eventID,
				"error_type", ErrorClass(err))
			continue
		}
		if present {
			// The store still holds the entry; confirm it holds the content
			// Discovery would push today.
			if err := r.indexer.Sync(ctx, eventID); err != nil {
				r.logger.WarnContext(ctx, "semantic_probe_sync_failed",
					"operation", Operation, "event_id", eventID,
					"error_type", ErrorClass(err))
			}
			continue
		}
		if err := r.indexer.Resync(ctx, eventID); err != nil {
			r.logger.WarnContext(ctx, "semantic_probe_restore_failed",
				"operation", Operation, "event_id", eventID,
				"error_type", ErrorClass(err))
			continue
		}
		r.logger.WarnContext(ctx, "semantic_probe_restored",
			"operation", Operation, "event_id", eventID)
	}
}

// canary runs one synthetic query so a store that answers every call but
// returns nothing still shows up on a dashboard.
func (r *Reconciler) canary(ctx context.Context) {
	published, err := r.repository.PublishedCount(ctx)
	if err != nil || published == 0 {
		return
	}
	candidates, err := r.store.Search(ctx, CanaryText, 1)
	switch {
	case err != nil:
		metrics.RecordSemanticCanary("failed")
		r.logger.WarnContext(ctx, "semantic_canary_failed",
			"operation", Operation, "error_type", ErrorClass(err))
	case len(candidates) == 0:
		metrics.RecordSemanticCanary("empty")
		r.logger.WarnContext(ctx, "semantic_canary_empty",
			"operation", Operation, "published", published)
	case candidates[0].Similarity < r.canaryFloor:
		metrics.RecordSemanticCanary("below_floor")
		r.logger.WarnContext(ctx, "semantic_canary_below_floor",
			"operation", Operation, "floor", r.canaryFloor)
	default:
		metrics.RecordSemanticCanary("ok")
	}
}
