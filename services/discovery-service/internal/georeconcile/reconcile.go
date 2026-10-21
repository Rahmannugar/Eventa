package georeconcile

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/eventa/discovery-service/internal/index"
	"github.com/eventa/discovery-service/internal/logging"
)

// Resolver is the Event Service lookup the lifecycle consumer already uses.
type Resolver interface {
	GetPublishedContent(ctx context.Context, eventID string) (*index.Content, error)
}

// Reconciler is the recovery owner for index rows that predate venue
// coordinates. Each pass enqueues rows still missing coordinates, claims a
// bounded due batch, and refreshes each row through the Event Service lookup.
type Reconciler struct {
	repository *Repository
	resolver   Resolver
	batch      int
	logger     *slog.Logger
}

func NewReconciler(repository *Repository, resolver Resolver, batch int) *Reconciler {
	return &Reconciler{
		repository: repository,
		resolver:   resolver,
		batch:      batch,
		logger:     logging.New("VenueGeoReconciler"),
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

// Pass performs one bounded cycle: enqueue every published row still missing
// coordinates, then refresh the work that is due.
func (r *Reconciler) Pass(ctx context.Context) {
	if err := r.repository.EnqueueMissing(ctx); err != nil {
		r.logger.WarnContext(ctx, "venue_geo_enqueue_unavailable",
			"operation", "venue_geo_reconcile", "error_type", errorClass(err))
		return
	}
	work, err := r.repository.ClaimDue(ctx, r.batch)
	if err != nil {
		r.logger.WarnContext(ctx, "venue_geo_claim_unavailable",
			"operation", "venue_geo_reconcile", "error_type", errorClass(err))
		return
	}
	for _, item := range work {
		r.refresh(ctx, item)
	}
}

// refresh resolves one event's authoritative content and either stores its
// coordinates, closes the work because Event Service serves none, or spends
// an attempt when the lookup fails.
func (r *Reconciler) refresh(ctx context.Context, item Work) {
	content, err := r.resolver.GetPublishedContent(ctx, item.EventID)
	switch {
	case errors.Is(err, index.ErrContentUnavailable):
		// The event is no longer served as published; its lifecycle row is
		// the authority now and coordinates no longer matter.
		r.complete(ctx, item.EventID)
	case err != nil:
		r.reschedule(ctx, item)
	case content.VenueLatitude == nil || content.VenueLongitude == nil:
		// Event Service authoritatively serves no coordinates; a future
		// publish fact carries them if they ever exist.
		r.complete(ctx, item.EventID)
	default:
		if err := r.repository.ApplyCoordinates(ctx, item.EventID,
			*content.VenueLatitude, *content.VenueLongitude,
		); err != nil {
			r.logger.WarnContext(ctx, "venue_geo_apply_failed",
				"operation", "venue_geo_reconcile",
				"event_id", item.EventID, "error_type", errorClass(err))
			r.reschedule(ctx, item)
			return
		}
		r.logger.WarnContext(ctx, "venue_geo_repaired",
			"operation", "venue_geo_reconcile", "event_id", item.EventID)
		r.complete(ctx, item.EventID)
	}
}

func (r *Reconciler) complete(ctx context.Context, eventID string) {
	if err := r.repository.Complete(ctx, eventID); err != nil {
		r.logger.WarnContext(ctx, "venue_geo_complete_failed",
			"operation", "venue_geo_reconcile",
			"event_id", eventID, "error_type", errorClass(err))
	}
}

func (r *Reconciler) reschedule(ctx context.Context, item Work) {
	next := time.Now().UTC().Add(backoff(item.AttemptCount))
	if err := r.repository.Reschedule(ctx, item.EventID, next); err != nil {
		r.logger.WarnContext(ctx, "venue_geo_reschedule_failed",
			"operation", "venue_geo_reconcile",
			"event_id", item.EventID, "error_type", errorClass(err))
	}
}

// backoff doubles the wait per attempt from one minute up to one hour, so a
// persistently failing lookup is retried bounded work, not hot-looped.
func backoff(attemptCount int) time.Duration {
	const minute = time.Minute
	const cap = 60 * minute
	shift := attemptCount
	if shift > 6 {
		shift = 6
	}
	wait := minute * (1 << shift)
	if wait > cap {
		return cap
	}
	return wait
}

func errorClass(err error) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	case errors.Is(err, context.Canceled):
		return "canceled"
	default:
		return "internal"
	}
}
