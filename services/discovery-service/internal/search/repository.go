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
// stay pointers because Event Service does not require them. DistanceKm is
// set only when the query carried a proximity clause.
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
	VenueLatitude    *float64
	VenueLongitude   *float64
	DistanceKm       *float64
}

// Repository queries the Discovery-owned projection. It never touches
// another service's database.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository binds the pool the service already owns.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

const rowColumns = `event_id, title, description, starts_at, ends_at, time_zone,
	categories, venue_name, venue_city, venue_country_code, venue_latitude, venue_longitude`

// baseWhere is the shared predicate of the page query and the count. Only
// published rows that Discovery actually holds content for are searchable:
// a cancelled tombstone and a published row whose content Event no longer
// serves both carry no title. The proximity clause is part of the predicate,
// so the count and the page agree on which rows are near, and it returns the
// bound point's parameter numbers for the distance projection; a row without
// coordinates falls out of the distance predicate on NULL.
func baseWhere(filters *Filters, args *[]any) (string, [2]string) {
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

	nearParams := [2]string{}
	if filters.Near != nil {
		*args = append(*args, filters.Near.Longitude)
		longitude := parameter(*args)
		*args = append(*args, filters.Near.Latitude)
		latitude := parameter(*args)
		*args = append(*args, filters.Near.RadiusKm*1000)
		radius := parameter(*args)
		clauses = append(clauses, fmt.Sprintf(
			`ST_DWithin(venue_geo, ST_SetSRID(ST_MakePoint($%s, $%s), 4326)::geography, $%s)`,
			longitude, latitude, radius))
		nearParams = [2]string{longitude, latitude}
	}

	return strings.Join(clauses, " AND "), nearParams
}

// parameter names the next bind placeholder from the argument count.
func parameter(args []any) string { return fmt.Sprintf("%d", len(args)) }

// escapeLike neutralises the wildcards a caller could otherwise inject into
// the substring match, so a query of "100%" matches the literal text.
func escapeLike(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(value)
}

// Search returns one page of matching events plus the total match count.
// Without a proximity clause the page is ordered by start time so pagination
// is stable; with one it is ordered by distance from the requested point
// first, then start time, and each row carries its distance.
func (r *Repository) Search(ctx context.Context, filters Filters) ([]Row, int, error) {
	whereArgs := make([]any, 0, 7+len(filters.Categories))
	where, nearParams := baseWhere(&filters, &whereArgs)

	countArgs := append([]any{}, whereArgs...)
	var total int
	if err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM discovery_event_index WHERE `+where, countArgs...,
	).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count search results: %w", err)
	}

	// Geography distances are metres on the spheroid; the API speaks
	// kilometres, so the projection divides once at the edge of the query.
	distanceSelect := `NULL::float8 AS distance_km`
	orderBy := `ORDER BY starts_at ASC NULLS LAST, event_id ASC`
	if filters.Near != nil {
		distanceSelect = fmt.Sprintf(
			`ST_Distance(venue_geo, ST_SetSRID(ST_MakePoint($%s, $%s), 4326)::geography) / 1000.0 AS distance_km`,
			nearParams[0], nearParams[1])
		orderBy = `ORDER BY distance_km ASC, starts_at ASC NULLS LAST, event_id ASC`
	}

	pageArgs := append([]any{}, whereArgs...)
	pageArgs = append(pageArgs, filters.Limit, filters.Offset)
	query := fmt.Sprintf(
		`SELECT %s, %s FROM discovery_event_index WHERE %s
		 %s
		 LIMIT $%d OFFSET $%d`,
		rowColumns, distanceSelect, where, orderBy, len(pageArgs)-1, len(pageArgs),
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
			&row.VenueLatitude, &row.VenueLongitude,
			&row.DistanceKm,
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
