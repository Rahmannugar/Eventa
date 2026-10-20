package performance

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/analytics-service/internal/facts"
)

// Repository persists the inbox claim and the projection row. Every write
// runs on the caller's transaction so one fact is claimed and applied
// atomically.
type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

func (r *Repository) begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	return tx, nil
}

// claim records the fact in the durable inbox. A false result means the fact
// was already applied, so the caller must do no further work.
func claim(ctx context.Context, tx pgx.Tx, fact facts.Fact) (bool, error) {
	var applied string
	err := tx.QueryRow(ctx, `
		INSERT INTO analytics_event_inbox (event_type, message_id, event_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (event_type, message_id) DO NOTHING
		RETURNING event_type
	`, fact.Type, fact.DedupeKey(), fact.EventID).Scan(&applied)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim performance fact: %w", err)
	}
	return true, nil
}

// apply dispatches one claimed fact to its projection statement.
func apply(ctx context.Context, tx pgx.Tx, kind facts.Kind, fact facts.Fact) error {
	switch kind {
	case facts.KindOrderPaid:
		return applyOrderPaid(ctx, tx, fact)
	case facts.KindOrderRefunded:
		return applyOrderRefunded(ctx, tx, fact)
	case facts.KindCheckedIn:
		return applyCounter(ctx, tx, "tickets_checked_in", fact)
	case facts.KindRevoked:
		return applyCounter(ctx, tx, "tickets_revoked", fact)
	case facts.KindPublished:
		return applyPublished(ctx, tx, fact)
	case facts.KindCancelled:
		return applyCancelled(ctx, tx, fact)
	default:
		return fmt.Errorf("unhandled fact kind %d", kind)
	}
}

// applyOrderPaid adds one paid order's tickets and gross amount. The event
// row is created when the first fact for it arrives; currency is kept from
// the first snapshot, and a later mismatched currency never overwrites it.
func applyOrderPaid(ctx context.Context, tx pgx.Tx, fact facts.Fact) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO analytics_event_performance (
			event_id, currency, tickets_sold, gross_revenue_minor, updated_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (event_id) DO UPDATE SET
			currency = COALESCE(analytics_event_performance.currency, EXCLUDED.currency),
			tickets_sold = analytics_event_performance.tickets_sold + EXCLUDED.tickets_sold,
			gross_revenue_minor = analytics_event_performance.gross_revenue_minor + EXCLUDED.gross_revenue_minor,
			updated_at = now()
	`, fact.EventID, fact.Currency, fact.Quantity, fact.TotalMinor)
	if err != nil {
		return fmt.Errorf("apply order paid: %w", err)
	}
	return nil
}

// applyOrderRefunded adds one refunded order's tickets and amount. A refund
// without a prior paid fact still records honestly: refunded counters move
// while sold stays at zero.
func applyOrderRefunded(ctx context.Context, tx pgx.Tx, fact facts.Fact) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO analytics_event_performance (
			event_id, currency, tickets_refunded, refunded_revenue_minor, updated_at)
		VALUES ($1, $2, $3, $4, now())
		ON CONFLICT (event_id) DO UPDATE SET
			currency = COALESCE(analytics_event_performance.currency, EXCLUDED.currency),
			tickets_refunded = analytics_event_performance.tickets_refunded + EXCLUDED.tickets_refunded,
			refunded_revenue_minor = analytics_event_performance.refunded_revenue_minor + EXCLUDED.refunded_revenue_minor,
			updated_at = now()
	`, fact.EventID, fact.Currency, fact.Quantity, fact.TotalMinor)
	if err != nil {
		return fmt.Errorf("apply order refunded: %w", err)
	}
	return nil
}

// applyCounter adds a ticket-lifecycle quantity to its column. The column is
// chosen by the caller from the fixed pair this projection owns, so the
// identifier never comes from user input.
func applyCounter(ctx context.Context, tx pgx.Tx, column string, fact facts.Fact) error {
	_, err := tx.Exec(ctx, fmt.Sprintf(`
		INSERT INTO analytics_event_performance (event_id, %s, updated_at)
		VALUES ($1, $2, now())
		ON CONFLICT (event_id) DO UPDATE SET
			%s = analytics_event_performance.%s + EXCLUDED.%s,
			updated_at = now()
	`, column, column, column, column), fact.EventID, fact.Quantity)
	if err != nil {
		return fmt.Errorf("apply %s: %w", column, err)
	}
	return nil
}

// applyPublished records that the event is live. A tombstone written by an
// earlier cancelled fact keeps its cancelled timestamp and stays cancelled
// only until this fact flips it; a replayed publish is idempotent through the
// inbox.
func applyPublished(ctx context.Context, tx pgx.Tx, fact facts.Fact) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO analytics_event_performance (event_id, status, published_at, updated_at)
		VALUES ($1, 'published', $2, now())
		ON CONFLICT (event_id) DO UPDATE SET
			status = 'published',
			published_at = EXCLUDED.published_at,
			updated_at = now()
	`, fact.EventID, fact.PublishedAt)
	if err != nil {
		return fmt.Errorf("apply published: %w", err)
	}
	return nil
}

// applyCancelled records that the event is no longer live. It inserts a
// tombstone when the publish fact was never seen, so an event with only late
// revenue facts is still known to be cancelled.
func applyCancelled(ctx context.Context, tx pgx.Tx, fact facts.Fact) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO analytics_event_performance (event_id, status, cancelled_at, updated_at)
		VALUES ($1, 'cancelled', $2, now())
		ON CONFLICT (event_id) DO UPDATE SET
			status = 'cancelled',
			cancelled_at = EXCLUDED.cancelled_at,
			updated_at = now()
	`, fact.EventID, fact.CancelledAt)
	if err != nil {
		return fmt.Errorf("apply cancelled: %w", err)
	}
	return nil
}
