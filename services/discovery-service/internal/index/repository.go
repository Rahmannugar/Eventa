package index

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository persists the inbox claim and the index row. Every write runs on
// the caller's transaction so one fact is claimed and applied atomically.
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
func claim(ctx context.Context, tx pgx.Tx, fact Fact) (bool, error) {
	var applied string
	err := tx.QueryRow(ctx, `
		INSERT INTO discovery_event_inbox (event_type, message_id, event_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (event_type, message_id) DO NOTHING
		RETURNING event_type
	`, fact.Type, fact.DedupeKey(), fact.EventID).Scan(&applied)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim lifecycle fact: %w", err)
	}
	return true, nil
}

// indexPublished writes the authoritative content Discovery copied out of Event
// Service. A nil content means Event no longer serves the event, so the row
// records the publication without inventing content it does not have.
func indexPublished(ctx context.Context, tx pgx.Tx, fact Fact, content *Content) error {
	args := append([]any{fact.EventID, fact.Version, fact.PublishedAt}, publishedColumns(content)...)
	_, err := tx.Exec(ctx, `
		INSERT INTO discovery_event_index (
			event_id, status, version, published_at, title, description,
			starts_at, ends_at, time_zone, categories, venue_name, venue_city,
			venue_country_code, indexed_at, updated_at)
		VALUES ($1, 'published', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
		ON CONFLICT (event_id) DO UPDATE SET
			status = EXCLUDED.status,
			version = EXCLUDED.version,
			published_at = EXCLUDED.published_at,
			title = EXCLUDED.title,
			description = EXCLUDED.description,
			starts_at = EXCLUDED.starts_at,
			ends_at = EXCLUDED.ends_at,
			time_zone = EXCLUDED.time_zone,
			categories = EXCLUDED.categories,
			venue_name = EXCLUDED.venue_name,
			venue_city = EXCLUDED.venue_city,
			venue_country_code = EXCLUDED.venue_country_code,
			updated_at = now()
	`, args...)
	if err != nil {
		return fmt.Errorf("index published event: %w", err)
	}
	return nil
}

// markCancelled records that an event is no longer discoverable. It inserts a
// tombstone when Discovery never saw the publish, so an event it has never
// indexed is still known to be cancelled.
func markCancelled(ctx context.Context, tx pgx.Tx, fact Fact) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO discovery_event_index (event_id, status, cancelled_at, updated_at)
		VALUES ($1, 'cancelled', $2, now())
		ON CONFLICT (event_id) DO UPDATE SET
			status = 'cancelled',
			cancelled_at = EXCLUDED.cancelled_at,
			updated_at = now()
	`, fact.EventID, fact.CancelledAt)
	if err != nil {
		return fmt.Errorf("mark event cancelled: %w", err)
	}
	return nil
}

// publishedColumns lays out the content columns in the same order as the
// INSERT above. A nil content means Event Service no longer serves the event,
// so every content column stays null rather than being invented.
func publishedColumns(content *Content) []any {
	if content == nil {
		return []any{nil, nil, nil, nil, nil, []string{}, nil, nil, nil}
	}
	return []any{
		content.Title, content.Description,
		optionalTime(content.StartsAt), optionalTime(content.EndsAt),
		optionalText(content.TimeZone), categoryList(content),
		optionalText(content.VenueName), optionalText(content.VenueCity),
		optionalText(content.VenueCountryCode),
	}
}
