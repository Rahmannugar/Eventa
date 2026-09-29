package recommendations

import (
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/eventa/discovery-service/internal/index"
	"github.com/eventa/discovery-service/internal/semantic"
)

func TestParseLimitUsesTheDefaultPageForTheProto3Default(t *testing.T) {
	limit, err := parseLimit(0)
	if err != nil {
		t.Fatalf("parseLimit(0) returned %v", err)
	}
	if limit != DefaultLimit {
		t.Errorf("limit = %d, want %d", limit, DefaultLimit)
	}
}

func TestParseLimitRejectsPagesOutsideTheSupportedRange(t *testing.T) {
	for _, raw := range []int32{-1, MaxLimit + 1} {
		if _, err := parseLimit(raw); status.Code(err) != codes.InvalidArgument {
			t.Errorf("parseLimit(%d) error = %v, want InvalidArgument", raw, err)
		}
	}
}

func TestCandidateLimitOverfetchesAndStaysBounded(t *testing.T) {
	if got := candidateLimit(1); got != minCandidates {
		t.Errorf("candidateLimit(1) = %d, want %d", got, minCandidates)
	}
	if got := candidateLimit(DefaultLimit); got != DefaultLimit*candidateOverfetch {
		t.Errorf("candidateLimit(%d) = %d, want %d", DefaultLimit, got, DefaultLimit*candidateOverfetch)
	}
	if got := candidateLimit(MaxLimit); got != maxCandidates {
		t.Errorf("candidateLimit(%d) = %d, want the %d cap", MaxLimit, got, maxCandidates)
	}
}

func TestUniqueIDsKeepsStoreOrderAndDropsDuplicates(t *testing.T) {
	ids := uniqueIDs([]semantic.Candidate{
		{EventID: "first", Similarity: 0.9},
		{EventID: "second", Similarity: 0.8},
		{EventID: "first", Similarity: 0.7},
	})

	want := []string{"first", "second"}
	if len(ids) != len(want) {
		t.Fatalf("ids = %v, want %v", ids, want)
	}
	for i, id := range want {
		if ids[i] != id {
			t.Errorf("ids[%d] = %q, want %q", i, ids[i], id)
		}
	}
}

func TestToResultRendersResolvedContentInSearchShape(t *testing.T) {
	startsAt := time.Date(2026, time.November, 14, 10, 0, 0, 0, time.UTC)
	endsAt := startsAt.Add(4 * time.Hour)
	result := toResult("event-1", &index.Content{
		Title:            "Lagos Street Food Festival",
		Description:      "Tastings from forty vendors.",
		StartsAt:         startsAt,
		EndsAt:           endsAt,
		TimeZone:         "Africa/Lagos",
		Categories:       []string{"food"},
		VenueName:        "Tafawa Balewa Square",
		VenueCity:        "Lagos",
		VenueCountryCode: "NG",
	})

	if result.GetEventId() != "event-1" || result.GetTitle() != "Lagos Street Food Festival" {
		t.Errorf("result = %v, want the resolved event", result)
	}
	if result.GetStartsAt() != "2026-11-14T10:00:00Z" {
		t.Errorf("starts_at = %q, want RFC 3339 in UTC", result.GetStartsAt())
	}
	if result.GetVenueCountryCode() != "NG" || len(result.GetCategories()) != 1 {
		t.Errorf("venue and categories not rendered: %v", result)
	}
}
