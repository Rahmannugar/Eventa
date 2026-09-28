// Package search answers Discovery's structured query over the event
// projection it owns. Exact filters are ordinary SQL: no vector store is
// involved, and no row that Event Service has cancelled can be returned.
package search

import (
	"errors"
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
)

// ErrInvalidFilters is the caller-facing failure for a malformed query. The
// transport reports it as an invalid argument and never as a server error.
var ErrInvalidFilters = errors.New("invalid search filters")

// Filters is a validated, bounded query.
type Filters struct {
	Query      string
	Categories []string
	StartsFrom *time.Time
	StartsTo   *time.Time
	Limit      int
	Offset     int
}

// Parse validates raw request values into filters. Empty optional strings
// mean "no bound"; a bound that cannot be parsed as RFC 3339 is rejected
// rather than silently ignored, so a client never gets a wider result set
// than it asked for.
func Parse(query string, categories []string, startsFrom, startsTo string, limit, offset int32) (Filters, error) {
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
