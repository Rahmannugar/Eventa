package search

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestParseAppliesDefaultAndMaximumPageBounds(t *testing.T) {
	tests := []struct {
		name   string
		limit  int32
		offset int32
		want   Filters
	}{
		{name: "zero limit falls back to the default", limit: 0, offset: 0,
			want: Filters{Limit: DefaultLimit, Offset: 0}},
		{name: "limit above the maximum is clamped", limit: 500, offset: 3,
			want: Filters{Limit: MaxLimit, Offset: 3}},
		{name: "limit inside the range is kept", limit: 7, offset: 40,
			want: Filters{Limit: 7, Offset: 40}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := Parse("", nil, "", "", test.limit, test.offset)
			if err != nil {
				t.Fatalf("Parse returned error: %v", err)
			}
			if got.Limit != test.want.Limit || got.Offset != test.want.Offset {
				t.Fatalf("got limit %d offset %d, want limit %d offset %d",
					got.Limit, got.Offset, test.want.Limit, test.want.Offset)
			}
		})
	}
}

func TestParseRejectsMalformedRequests(t *testing.T) {
	tests := []struct {
		name   string
		query  string
		from   string
		to     string
		limit  int32
		offset int32
	}{
		{name: "negative limit", limit: -1},
		{name: "negative offset", offset: -1},
		{name: "offset beyond the deep page bound", offset: MaxOffset + 1},
		{name: "query longer than the bound", query: strings.Repeat("a", MaxQueryRunes+1)},
		{name: "start bound that is not RFC 3339", from: "next tuesday"},
		{name: "end bound that is not RFC 3339", to: "2026-13-45"},
		{
			name: "start bound after the end bound",
			from: time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC).Format(time.RFC3339),
			to:   time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339),
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := Parse(test.query, nil, test.from, test.to, test.limit, test.offset)
			if !errors.Is(err, ErrInvalidFilters) {
				t.Fatalf("got error %v, want ErrInvalidFilters", err)
			}
		})
	}
}

func TestParseKeepsOnlyDistinctNonEmptyCategories(t *testing.T) {
	filters, err := Parse("", []string{" Music ", "music", "", "  ", "Food"}, "", "", 0, 0)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}
	if len(filters.Categories) != 2 || filters.Categories[0] != "Music" || filters.Categories[1] != "Food" {
		t.Fatalf("got categories %v, want [Music Food]", filters.Categories)
	}
}

func TestParseBoundsTheCategoryList(t *testing.T) {
	values := make([]string, MaxCategories+3)
	for i := range values {
		values[i] = strings.Repeat("c", 3) + string(rune('a'+i))
	}

	filters, err := Parse("", values, "", "", 0, 0)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}
	if len(filters.Categories) != MaxCategories {
		t.Fatalf("got %d categories, want %d", len(filters.Categories), MaxCategories)
	}
}

func TestParseKeepsTimeBounds(t *testing.T) {
	from := time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)
	to := time.Date(2026, 12, 1, 18, 0, 0, 0, time.UTC)

	filters, err := Parse("festival", nil, from.Format(time.RFC3339), to.Format(time.RFC3339), 0, 0)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}
	if filters.StartsFrom == nil || !filters.StartsFrom.Equal(from) {
		t.Fatalf("got start bound %v, want %v", filters.StartsFrom, from)
	}
	if filters.StartsTo == nil || !filters.StartsTo.Equal(to) {
		t.Fatalf("got end bound %v, want %v", filters.StartsTo, to)
	}
}
