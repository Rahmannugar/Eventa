// Package reporting serves the Analytics read API over gRPC against the
// event performance projection.
package reporting

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Row is one event's projection as stored.
type Row struct {
	EventID              uuid.UUID
	Status               string
	Currency             *string
	TicketsSold          int64
	TicketsRefunded      int64
	TicketsCheckedIn     int64
	TicketsRevoked       int64
	GrossRevenueMinor    int64
	RefundedRevenueMinor int64
	PublishedAt          *time.Time
	CancelledAt          *time.Time
	UpdatedAt            time.Time
}

// CurrencyRow is one currency's totals across the portfolio.
type CurrencyRow struct {
	Currency             string
	TicketsSold          int64
	TicketsRefunded      int64
	GrossRevenueMinor    int64
	RefundedRevenueMinor int64
}

// Summary is the portfolio roll-up.
type Summary struct {
	EventsPublished  int32
	EventsCancelled  int32
	TicketsCheckedIn int64
	TicketsRevoked   int64
	Revenue          []CurrencyRow
}

// Repository reads the performance projection. It never writes.
type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

const rowColumns = `event_id, status, currency, tickets_sold, tickets_refunded,
	tickets_checked_in, tickets_revoked, gross_revenue_minor,
	refunded_revenue_minor, published_at, cancelled_at, updated_at`

// List reads one page of the projection ordered by event id, with an exact
// total for the same filter so a caller can page without a second count
// query shape.
func (r *Repository) List(ctx context.Context, limit, offset int, status string) ([]Row, int, error) {
	var total int
	if status == "" {
		if err := r.pool.QueryRow(ctx,
			`SELECT count(*) FROM analytics_event_performance`).Scan(&total); err != nil {
			return nil, 0, fmt.Errorf("count event performance: %w", err)
		}
	} else {
		if err := r.pool.QueryRow(ctx,
			`SELECT count(*) FROM analytics_event_performance WHERE status = $1`,
			status).Scan(&total); err != nil {
			return nil, 0, fmt.Errorf("count event performance: %w", err)
		}
	}

	var (
		rows pgx.Rows
		err  error
	)
	if status == "" {
		rows, err = r.pool.Query(ctx, fmt.Sprintf(`
			SELECT %s FROM analytics_event_performance
			ORDER BY event_id
			LIMIT $1 OFFSET $2`, rowColumns), limit, offset)
	} else {
		rows, err = r.pool.Query(ctx, fmt.Sprintf(`
			SELECT %s FROM analytics_event_performance
			WHERE status = $1
			ORDER BY event_id
			LIMIT $2 OFFSET $3`, rowColumns), status, limit, offset)
	}
	if err != nil {
		return nil, 0, fmt.Errorf("list event performance: %w", err)
	}
	defer rows.Close()

	projection := make([]Row, 0, limit)
	for rows.Next() {
		row, err := scanRow(rows)
		if err != nil {
			return nil, 0, err
		}
		projection = append(projection, *row)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate event performance: %w", err)
	}
	return projection, total, nil
}

// Get reads one event's row. A pgx.ErrNoRows wrapped by scanRow means the
// event has no projection yet, which the handler reports as not found.
func (r *Repository) Get(ctx context.Context, eventID uuid.UUID) (*Row, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT `+rowColumns+` FROM analytics_event_performance
		WHERE event_id = $1`, eventID)
	return scanRow(row)
}

// Summary rolls the whole portfolio up in two queries: one for the scalar
// totals and one for the per-currency revenue split.
func (r *Repository) Summary(ctx context.Context) (*Summary, error) {
	summary := &Summary{Revenue: []CurrencyRow{}}
	err := r.pool.QueryRow(ctx, `
		SELECT
			count(*) FILTER (WHERE status = 'published'),
			count(*) FILTER (WHERE status = 'cancelled'),
			COALESCE(sum(tickets_checked_in), 0),
			COALESCE(sum(tickets_revoked), 0)
		FROM analytics_event_performance`).Scan(
		&summary.EventsPublished, &summary.EventsCancelled,
		&summary.TicketsCheckedIn, &summary.TicketsRevoked)
	if err != nil {
		return nil, fmt.Errorf("summarise event performance: %w", err)
	}

	rows, err := r.pool.Query(ctx, `
		SELECT currency,
			COALESCE(sum(tickets_sold), 0),
			COALESCE(sum(tickets_refunded), 0),
			COALESCE(sum(gross_revenue_minor), 0),
			COALESCE(sum(refunded_revenue_minor), 0)
		FROM analytics_event_performance
		WHERE currency IS NOT NULL
		GROUP BY currency
		ORDER BY currency`)
	if err != nil {
		return nil, fmt.Errorf("summarise revenue by currency: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var currencyRow CurrencyRow
		if err := rows.Scan(
			&currencyRow.Currency, &currencyRow.TicketsSold,
			&currencyRow.TicketsRefunded, &currencyRow.GrossRevenueMinor,
			&currencyRow.RefundedRevenueMinor); err != nil {
			return nil, fmt.Errorf("scan revenue currency row: %w", err)
		}
		summary.Revenue = append(summary.Revenue, currencyRow)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate revenue currency rows: %w", err)
	}
	return summary, nil
}

func scanRow(row pgx.Row) (*Row, error) {
	var stored Row
	err := row.Scan(
		&stored.EventID, &stored.Status, &stored.Currency,
		&stored.TicketsSold, &stored.TicketsRefunded,
		&stored.TicketsCheckedIn, &stored.TicketsRevoked,
		&stored.GrossRevenueMinor, &stored.RefundedRevenueMinor,
		&stored.PublishedAt, &stored.CancelledAt, &stored.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("scan event performance row: %w", err)
	}
	return &stored, nil
}
