// Package search answers Discovery's structured query over the event
// projection it owns. Exact filters are ordinary SQL: no vector store is
// involved, and no row that Event Service has cancelled can be returned.
package search

import (
	"errors"
	"math"
	"strings"
	"time"
)

const (
	// DefaultLimit applies when a caller asks for no page size.
	DefaultLimit = 20
	// MaxLimit bounds one page so a single request cannot scan the index.
	MaxLimit = 50
	// MaxOffset bounds deep pagination for the same reason.
	MaxOffset = 10_000
	// MaxQueryRunes bounds free text before it becomes a scan cost.
	MaxQueryRunes = 200
	// MaxCategories bounds how many exact categories one request may filter on.
	MaxCategories = 10
	// MaxCategoryRunes bounds a single category value.
	MaxCategoryRunes = 100
	// MaxRadiusKm bounds the proximity radius: anything beyond the farthest
	// two points on Earth asks for the whole planet, not a search.
	MaxRadiusKm = 20_000
)

// ErrInvalidFilters is the caller-facing failure for a malformed query. The
// transport reports it as an invalid argument and never as a server error.
var ErrInvalidFilters = errors.New("invalid search filters")

// Near is a validated proximity clause: a point on the globe and the radius
// around it the page must stay inside.
type Near struct {
	Latitude  float64
	Longitude float64
	RadiusKm  float64
}

// Filters is a validated, bounded query.
type Filters struct {
	Query      string
	Categories []string
	StartsFrom *time.Time
	StartsTo   *time.Time
	Near       *Near
	Limit      int
	Offset     int
}

// Parse validates raw request values into filters. Empty optional strings
// mean "no bound"; a bound that cannot be parsed as RFC 3339 is rejected
// rather than silently ignored, so a client never gets a wider result set
// than it asked for. A nil near means no proximity clause; a near that is
// present must hold an in-range point and a positive radius, so a malformed
// clause is rejected instead of quietly widening the page.
func Parse(query string, categories []string, startsFrom, startsTo string, near *Near, limit, offset int32) (Filters, error) {
	filters := Filters{Query: strings.TrimSpace(query)}
	if len([]rune(filters.Query)) > MaxQueryRunes {
		return Filters{}, ErrInvalidFilters
	}

	filters.Categories = normalizeCategories(categories)
	from, err := optionalTimestamp(startsFrom)
	if err != nil {
		return Filters{}, err
	}
	to, err := optionalTimestamp(startsTo)
	if err != nil {
		return Filters{}, err
	}
	if from != nil && to != nil && from.After(*to) {
		return Filters{}, ErrInvalidFilters
	}
	filters.StartsFrom, filters.StartsTo = from, to

	if near != nil {
		if err := validateNear(near); err != nil {
			return Filters{}, err
		}
		filters.Near = near
	}

	switch {
	case limit < 0 || offset < 0:
		return Filters{}, ErrInvalidFilters
	case limit == 0:
		filters.Limit = DefaultLimit
	case limit > MaxLimit:
		filters.Limit = MaxLimit
	default:
		filters.Limit = int(limit)
	}
	if offset > MaxOffset {
		return Filters{}, ErrInvalidFilters
	}
	filters.Offset = int(offset)
	return filters, nil
}

// normalizeCategories trims, drops empties, de-duplicates, and bounds the
// list while preserving the caller's order.
func normalizeCategories(values []string) []string {
	seen := make(map[string]bool, len(values))
	kept := make([]string, 0, len(values))
	for _, value := range values {
		if len(kept) == MaxCategories {
			break
		}
		trimmed := strings.TrimSpace(value)
		if trimmed == "" || len([]rune(trimmed)) > MaxCategoryRunes {
			continue
		}
		key := strings.ToLower(trimmed)
		if seen[key] {
			continue
		}
		seen[key] = true
		kept = append(kept, trimmed)
	}
	return kept
}

func optionalTimestamp(raw string) (*time.Time, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return nil, ErrInvalidFilters
	}
	return &parsed, nil
}

// validateNear rejects a point outside the coordinate ranges and a radius
// that is not a positive distance within the bound. NaN and infinities are
// rejected explicitly because they slip through range comparisons.
func validateNear(near *Near) error {
	if math.IsNaN(near.Latitude) || math.IsInf(near.Latitude, 0) ||
		math.IsNaN(near.Longitude) || math.IsInf(near.Longitude, 0) ||
		math.IsNaN(near.RadiusKm) || math.IsInf(near.RadiusKm, 0) {
		return ErrInvalidFilters
	}
	if near.Latitude < -90 || near.Latitude > 90 ||
		near.Longitude < -180 || near.Longitude > 180 ||
		near.RadiusKm <= 0 || near.RadiusKm > MaxRadiusKm {
		return ErrInvalidFilters
	}
	return nil
}
