package search

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Row is one published event as the projection holds it. Optional columns
// stay pointers because Event Service does not require them.
type Row struct {
	EventID          uuid.UUID
	Title            string
	Description      *string
	StartsAt         *time.Time
	EndsAt           *time.Time
	TimeZone         *string
	Categories       []string
	VenueName        *string
	VenueCity        *string
	VenueCountryCode *string
}

// Repository queries the Discovery-owned projection. It never touches
// another service's database.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository binds the pool the service already owns.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

const rowColumns = `event_id, title, description, starts_at, ends_at, time_zone,
	categories, venue_name, venue_city, venue_country_code`

// baseWhere is the shared predicate of both the page query and the count.
// Only published rows that Discovery actually holds content for are
// searchable: a cancelled tombstone and a published row whose content Event
// no longer serves both carry no title.
func baseWhere(filters *Filters, args *[]any) string {
	clauses := []string{`status = 'published'`, `title IS NOT NULL`}

	if filters.Query != "" {
		*args = append(*args, "%"+escapeLike(filters.Query)+"%")
		parameter := parameter(*args)
		clauses = append(clauses, fmt.Sprintf(`(title ILIKE $%s OR description ILIKE $%s)`, parameter, parameter))
	}

	if len(filters.Categories) > 0 {
		*args = append(*args, filters.Categories)
		// Categories are matched on both sides case-insensitively, so a
		// request for "music" finds the row Event Service labelled "Music".
		clauses = append(clauses, fmt.Sprintf(
			`EXISTS (
				SELECT 1 FROM unnest(categories) AS stored
				WHERE lower(stored) = ANY (
					SELECT lower(wanted) FROM unnest($%s::text[]) AS wanted
				)
			)`, parameter(*args)))
	}

	if filters.StartsFrom != nil {
		*args = append(*args, *filters.StartsFrom)
		clauses = append(clauses, fmt.Sprintf(`starts_at >= $%s`, parameter(*args)))
	}

	if filters.StartsTo != nil {
		*args = append(*args, *filters.StartsTo)
		clauses = append(clauses, fmt.Sprintf(`starts_at <= $%s`, parameter(*args)))
	}

	return strings.Join(clauses, " AND ")
}

// parameter names the next bind placeholder from the argument count.
func parameter(args []any) string { return fmt.Sprintf("%d", len(args)) }

// escapeLike neutralises the wildcards a caller could otherwise inject into
// the substring match, so a query of "100%" matches the literal text.
func escapeLike(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(value)
}

// Search returns one page of matching events plus the total match count,
// ordered by start time so pagination is stable across requests.
func (r *Repository) Search(ctx context.Context, filters Filters) ([]Row, int, error) {
	whereArgs := make([]any, 0, 4+len(filters.Categories))
	where := baseWhere(&filters, &whereArgs)

	countArgs := append([]any{}, whereArgs...)
	var total int
	if err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM discovery_event_index WHERE `+where, countArgs...,
	).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count search results: %w", err)
	}

	pageArgs := append([]any{}, whereArgs...)
	pageArgs = append(pageArgs, filters.Limit, filters.Offset)
	query := fmt.Sprintf(
		`SELECT %s FROM discovery_event_index WHERE %s
		 ORDER BY starts_at ASC NULLS LAST, event_id ASC
		 LIMIT $%d OFFSET $%d`,
		rowColumns, where, len(pageArgs)-1, len(pageArgs),
	)

	rows, err := r.pool.Query(ctx, query, pageArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("query search results: %w", err)
	}
	defer rows.Close()

	results := make([]Row, 0, filters.Limit)
	for rows.Next() {
		var row Row
		if err := rows.Scan(
			&row.EventID, &row.Title, &row.Description, &row.StartsAt, &row.EndsAt,
			&row.TimeZone, &row.Categories, &row.VenueName, &row.VenueCity, &row.VenueCountryCode,
		); err != nil {
			return nil, 0, fmt.Errorf("scan search result: %w", err)
		}
		results = append(results, row)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate search results: %w", err)
	}
	return results, total, nil
}
