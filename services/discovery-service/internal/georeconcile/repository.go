// Package georeconcile backfills venue coordinates the event index is
// missing. Lifecycle facts only carry coordinates once Event Service has
// them; rows indexed before coordinates existed stay without them until this
// reconciler refreshes their venue through the same Event Service lookup the
// lifecycle consumer trusts. It never reads Event Service's database.
package georeconcile

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Work is one claimed refresh with the attempts already spent on it.
type Work struct {
	EventID      string
	AttemptCount int
}

// Repository owns the refresh work table and the coordinate columns of the
// event index.
type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// EnqueueMissing records every published index row that still lacks
// coordinates. It is idempotent: rerunning it never duplicates work.
func (r *Repository) EnqueueMissing(ctx context.Context) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO discovery_venue_geo_refresh (event_id)
		SELECT event_id FROM discovery_event_index
		WHERE status = 'published' AND venue_latitude IS NULL
		ON CONFLICT (event_id) DO NOTHING
	`)
	if err != nil {
		return fmt.Errorf("enqueue missing coordinates: %w", err)
	}
	return nil
}

// ClaimDue returns a bounded batch of work whose next attempt is due. A claim
// older than the staleness window is treated as crashed and reclaimed, so a
// restart mid-pass never strands a row.
func (r *Repository) ClaimDue(ctx context.Context, limit int) ([]Work, error) {
	rows, err := r.pool.Query(ctx, `
		WITH due AS (
			SELECT event_id, attempt_count
			FROM discovery_venue_geo_refresh
			WHERE next_attempt_at <= now()
			  AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
			ORDER BY next_attempt_at
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		UPDATE discovery_venue_geo_refresh w
		SET claimed_at = now()
		FROM due
		WHERE w.event_id = due.event_id
		RETURNING w.event_id, w.attempt_count
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("claim due refreshes: %w", err)
	}
	defer rows.Close()

	var work []Work
	for rows.Next() {
		var item Work
		if err := rows.Scan(&item.EventID, &item.AttemptCount); err != nil {
			return nil, fmt.Errorf("scan refresh claim: %w", err)
		}
		work = append(work, item)
	}
	return work, rows.Err()
}

// ApplyCoordinates stores the coordinates on the index row. A cancelled row
// is left alone: its status changed while the refresh was in flight, and the
// lifecycle fact already owns that transition.
func (r *Repository) ApplyCoordinates(ctx context.Context, eventID string, latitude, longitude float64) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE discovery_event_index
		SET venue_latitude = $2, venue_longitude = $3, updated_at = now()
		WHERE event_id = $1 AND status = 'published'
	`, eventID, latitude, longitude)
	if err != nil {
		return fmt.Errorf("apply venue coordinates: %w", err)
	}
	return nil
}

// Complete removes finished work: the coordinates landed, or Event Service
// authoritatively serves none for this event. A later coordinate change
// arrives through a fresh publish fact, not through this table.
func (r *Repository) Complete(ctx context.Context, eventID string) error {
	if _, err := r.pool.Exec(ctx,
		`DELETE FROM discovery_venue_geo_refresh WHERE event_id = $1`, eventID,
	); err != nil {
		return fmt.Errorf("complete venue geo refresh: %w", err)
	}
	return nil
}

// Reschedule spends one attempt and moves the row to its next due time.
func (r *Repository) Reschedule(ctx context.Context, eventID string, nextAttemptAt time.Time) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE discovery_venue_geo_refresh
		SET attempt_count = attempt_count + 1,
			next_attempt_at = $2,
			claimed_at = NULL
		WHERE event_id = $1
	`, eventID, nextAttemptAt)
	if err != nil {
		return fmt.Errorf("reschedule venue geo refresh: %w", err)
	}
	return nil
}
