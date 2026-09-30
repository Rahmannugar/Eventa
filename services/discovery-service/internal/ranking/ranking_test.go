package ranking

import (
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/eventa/discovery-service/internal/index"
	"github.com/eventa/discovery-service/internal/semantic"
)

func TestParseLimitUsesTheDefaultPageForTheProto3Default(t *testing.T) {
	limit, err := ParseLimit(0)
	if err != nil {
		t.Fatalf("parse limit: %v", err)
	}
	if limit != DefaultLimit {
		t.Errorf("limit = %d, want %d", limit, DefaultLimit)
	}
}

func TestParseLimitRejectsPagesOutsideTheSupportedRange(t *testing.T) {
	for _, raw := range []int32{-1, MaxLimit + 1} {
		if _, err := ParseLimit(raw); status.Code(err) != codes.InvalidArgument {
			t.Errorf("ParseLimit(%d) error = %v, want InvalidArgument", raw, err)
		}
	}
}

func TestCandidateLimitOverfetchesAndStaysBounded(t *testing.T) {
	if got := CandidateLimit(1); got != minCandidates {
		t.Errorf("CandidateLimit(1) = %d, want the %d candidate floor", got, minCandidates)
	}
	if got := CandidateLimit(MaxLimit); got != maxCandidates {
		t.Errorf("CandidateLimit(%d) = %d, want the %d candidate ceiling", MaxLimit, got, maxCandidates)
	}
}

func TestUniqueIDsKeepsStoreOrderAndDropsDuplicates(t *testing.T) {
	ids := UniqueIDs([]semantic.Candidate{
		{EventID: "b", Similarity: 0.9},
		{EventID: "a", Similarity: 0.8},
		{EventID: "b", Similarity: 0.8},
	})

	if len(ids) != 2 || ids[0] != "b" || ids[1] != "a" {
		t.Errorf("ids = %v, want store order without duplicates", ids)
	}
}

func TestToResultRendersResolvedContentInSearchShape(t *testing.T) {
	startsAt := time.Date(2026, time.November, 14, 10, 0, 0, 0, time.UTC)
	endsAt := startsAt.Add(4 * time.Hour)
	result := ToResult("event-1", &index.Content{
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

func TestResolveErrorKeepsADeadlineDistinguishableFromAnOutage(t *testing.T) {
	deadline := ResolveError(status.Error(codes.DeadlineExceeded, "slow"), "similar events unavailable")
	if status.Code(deadline) != codes.DeadlineExceeded {
		t.Errorf("deadline error = %v, want DeadlineExceeded", deadline)
	}
	if msg := status.Convert(deadline).Message(); msg != "event service did not answer in time" {
		t.Errorf("message = %q, want the deadline wording", msg)
	}

	outage := ResolveError(status.Error(codes.Unavailable, "down"), "similar events unavailable")
	if status.Code(outage) != codes.Unavailable || status.Convert(outage).Message() != "similar events unavailable" {
		t.Errorf("outage error = %v, want Unavailable carrying the calling API's message", outage)
	}
}
