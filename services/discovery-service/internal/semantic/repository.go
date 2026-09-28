package semantic

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Repository records what the derived store is believed to hold. Every row is
// recoverable from `discovery_event_index`, so this table is a mirror of an
// external state, never a source of truth.
type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// RecordPendingIndex runs inside the ingest transaction, so a published fact
// and the obligation to embed it commit together. If the process dies before
// the push, the row survives and the reconciler finishes the work.
func RecordPendingIndex(ctx context.Context, tx pgx.Tx, eventID, contentHash string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO discovery_semantic_index (event_id, status, content_hash, updated_at)
		VALUES ($1, 'pending_index', $2, now())
		ON CONFLICT (event_id) DO UPDATE SET
			status = 'pending_index',
			content_hash = EXCLUDED.content_hash,
			attempts = 0,
			last_error = NULL,
			updated_at = now()
	`, eventID, contentHash)
	if err != nil {
		return fmt.Errorf("record pending index: %w", err)
	}
	return nil
}

// RecordPendingRemoval runs inside the ingest transaction for a cancellation,
// so the obligation to remove the event from the store survives a crash.
func RecordPendingRemoval(ctx context.Context, tx pgx.Tx, eventID string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO discovery_semantic_index (event_id, status, updated_at)
		VALUES ($1, 'pending_removal', now())
		ON CONFLICT (event_id) DO UPDATE SET
			status = 'pending_removal',
			content_hash = NULL,
			attempts = 0,
			last_error = NULL,
			updated_at = now()
	`, eventID)
	if err != nil {
		return fmt.Errorf("record pending removal: %w", err)
	}
	return nil
}

// MarkIndexed records that the store now holds this content. It upserts, so an
// event the store has never seen still ends with a row describing it.
func (r *Repository) MarkIndexed(ctx context.Context, eventID, contentHash string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO discovery_semantic_index
			(event_id, status, content_hash, pushed_at, updated_at)
		VALUES ($1, 'indexed', $2, now(), now())
		ON CONFLICT (event_id) DO UPDATE SET
			status = 'indexed',
			content_hash = EXCLUDED.content_hash,
			attempts = 0,
			last_error = NULL,
			pushed_at = now(),
			updated_at = now()
	`, eventID, contentHash)
	if err != nil {
		return fmt.Errorf("mark indexed: %w", err)
	}
	return nil
}

// MarkRemoved records that the store holds nothing for this event.
func (r *Repository) MarkRemoved(ctx context.Context, eventID string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO discovery_semantic_index
			(event_id, status, pushed_at, updated_at)
		VALUES ($1, 'removed', now(), now())
		ON CONFLICT (event_id) DO UPDATE SET
			status = 'removed',
			content_hash = NULL,
			attempts = 0,
			last_error = NULL,
			pushed_at = now(),
			updated_at = now()
	`, eventID)
	if err != nil {
		return fmt.Errorf("mark removed: %w", err)
	}
	return nil
}

// RecordFailure keeps the row pending and remembers a bounded error class, so
// the next pass retries without the row looking successful.
func (r *Repository) RecordFailure(ctx context.Context, eventID, errorClass string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE discovery_semantic_index
		SET attempts = attempts + 1, last_error = $2, updated_at = now()
		WHERE event_id = $1
	`, eventID, errorClass)
	if err != nil {
		return fmt.Errorf("record semantic failure: %w", err)
	}
	return nil
}

// Work is one event whose derived store state does not match the projection.
type Work struct {
	EventID    string
	Desired    string // "index" or "remove"
	HasText    bool
	Hash       string
	Title      string
	Desc       string
	Categories []string
	VenueName  string
	VenueCity  string
	Actual     string // "" when the store has never seen the event
}

// ListWork returns a bounded batch of events whose stored state differs from
// the projection. It is both the retry queue and the reconciliation probe: a
// row the store silently lost reappears here.
func (r *Repository) ListWork(ctx context.Context, limit int) ([]Work, error) {
	rows, err := r.pool.Query(ctx, `
		WITH target AS (
			SELECT e.event_id,
				CASE
					WHEN e.status = 'published' AND e.title IS NOT NULL
						AND e.title <> '' THEN 'index'
					ELSE 'remove'
				END AS desired,
				e.title, e.description, e.categories, e.venue_name, e.venue_city
			FROM discovery_event_index e
			LEFT JOIN discovery_semantic_index s ON s.event_id = e.event_id
		)
		SELECT t.event_id, t.desired, COALESCE(t.title, ''),
			COALESCE(t.description, ''), t.categories,
			COALESCE(t.venue_name, ''), COALESCE(t.venue_city, ''),
			COALESCE(s.status, '') AS actual, COALESCE(s.content_hash, '') AS hash
		FROM target t
		LEFT JOIN discovery_semantic_index s ON s.event_id = t.event_id
		WHERE (t.desired = 'index' AND (s.event_id IS NULL OR s.status <> 'indexed'))
		   OR (t.desired = 'remove' AND s.event_id IS NOT NULL AND s.status <> 'removed')
		ORDER BY t.event_id
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("list semantic work: %w", err)
	}
	defer rows.Close()

	var work []Work
	for rows.Next() {
		var item Work
		if err := rows.Scan(&item.EventID, &item.Desired, &item.Title, &item.Desc,
			&item.Categories, &item.VenueName, &item.VenueCity, &item.Actual, &item.Hash); err != nil {
			return nil, fmt.Errorf("scan semantic work: %w", err)
		}
		item.HasText = item.Title != ""
		work = append(work, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate semantic work: %w", err)
	}
	return work, nil
}

// GetWork returns the convergence state of one event, or nil when the
// projection does not know it.
func (r *Repository) GetWork(ctx context.Context, eventID string) (*Work, error) {
	var item Work
	var categories []string
	err := r.pool.QueryRow(ctx, `
		SELECT e.event_id,
			CASE WHEN e.status = 'published' AND e.title IS NOT NULL
				AND e.title <> ''
				THEN 'index' ELSE 'remove' END AS desired,
			COALESCE(e.title, ''), COALESCE(e.description, ''), e.categories,
			COALESCE(e.venue_name, ''), COALESCE(e.venue_city, ''),
			COALESCE(s.status, ''), COALESCE(s.content_hash, '')
		FROM discovery_event_index e
		LEFT JOIN discovery_semantic_index s ON s.event_id = e.event_id
		WHERE e.event_id = $1
	`, eventID).Scan(&item.EventID, &item.Desired, &item.Title, &item.Desc,
		&categories, &item.VenueName, &item.VenueCity, &item.Actual, &item.Hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get semantic work: %w", err)
	}
	item.Categories = categories
	item.HasText = item.Title != ""
	return &item, nil
}

// PendingCount reports how many events still disagree with the store. It feeds
// the gauge operators alert on.
func (r *Repository) PendingCount(ctx context.Context) (int64, error) {
	var count int64
	err := r.pool.QueryRow(ctx, `
		WITH target AS (
			SELECT e.event_id,
				CASE WHEN e.status = 'published' AND e.title IS NOT NULL
					AND e.title <> ''
					THEN 'index' ELSE 'remove' END AS desired
			FROM discovery_event_index e
		)
		SELECT count(*)
		FROM target t
		LEFT JOIN discovery_semantic_index s ON s.event_id = t.event_id
		WHERE (t.desired = 'index' AND (s.event_id IS NULL OR s.status <> 'indexed'))
		   OR (t.desired = 'remove' AND s.event_id IS NOT NULL AND s.status <> 'removed')
	`).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count pending semantic rows: %w", err)
	}
	return count, nil
}

// ListPublishedIDs returns every event the projection says is searchable, in
// batches large enough for a full reindex.
func (r *Repository) ListPublishedIDs(ctx context.Context, offset, limit int) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT event_id FROM discovery_event_index
		WHERE status = 'published' AND title IS NOT NULL AND title <> ''
		ORDER BY event_id
		OFFSET $1 LIMIT $2
	`, offset, limit)
	if err != nil {
		return nil, fmt.Errorf("list published ids: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan published id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// PublishedCount reports how many events the projection says are searchable.
// The canary is only meaningful when this is greater than zero.
func (r *Repository) PublishedCount(ctx context.Context) (int64, error) {
	var count int64
	err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM discovery_event_index
		WHERE status = 'published' AND title IS NOT NULL AND title <> ''
	`).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("count published rows: %w", err)
	}
	return count, nil
}

// ProbeSample returns indexed events to confirm the store still holds them. A
// snapshot-backed store can lose rows without ever reporting an error.
func (r *Repository) ProbeSample(ctx context.Context, limit int) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT event_id FROM discovery_semantic_index
		WHERE status = 'indexed'
		ORDER BY event_id
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("probe sample: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan probe sample: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ErrorClass reduces a transport failure to a bounded label safe to store and
// to put on a metric. It never carries a message, a payload, or a query.
func ErrorClass(err error) string {
	if err == nil {
		return ""
	}
	switch code := status.Code(err); code {
	case codes.DeadlineExceeded:
		return "deadline_exceeded"
	case codes.Canceled:
		return "canceled"
	case codes.Unavailable:
		return "unavailable"
	case codes.Unknown:
		var timeout interface{ Timeout() bool }
		if errors.As(err, &timeout) && timeout.Timeout() {
			return "deadline_exceeded"
		}
		return "unknown"
	default:
		return strings.ToLower(code.String())
	}
}
