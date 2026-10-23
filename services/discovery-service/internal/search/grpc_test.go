package search

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	discoveryv1 "github.com/eventa/discovery-service/internal/gen/eventa/discovery/v1"
	"github.com/eventa/discovery-service/internal/logging"
)

func TestSearchEventsRejectsAMalformedQueryWithoutQuerying(t *testing.T) {
	// A nil repository proves the rejection happens before any database work:
	// reaching the repository would panic rather than return a status.
	handler := NewHandler(nil, logging.New("SearchHandler"))

	_, err := handler.SearchEvents(context.Background(), &discoveryv1.SearchEventsRequest{
		Query:      "festival",
		StartsFrom: stringPointer("whenever"),
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("got code %s for a malformed request, want %s", status.Code(err), codes.InvalidArgument)
	}
}

func stringPointer(value string) *string { return &value }

func TestSearchEventsRejectsAMalformedNearClauseWithoutQuerying(t *testing.T) {
	// A nil repository proves the rejection happens before any database work:
	// reaching the repository would panic rather than return a status.
	handler := NewHandler(nil, logging.New("SearchHandler"))

	_, err := handler.SearchEvents(context.Background(), &discoveryv1.SearchEventsRequest{
		Near: &discoveryv1.NearClause{Latitude: 6.5244, Longitude: 3.3792, RadiusKm: 0},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("got code %s for a zero radius, want %s", status.Code(err), codes.InvalidArgument)
	}
}

func TestSearchResultIncludesVenueCoordinates(t *testing.T) {
	latitude, longitude := 6.5244, 3.3792
	result := toResult(&Row{
		EventID:        uuid.New(),
		Title:          "Lagos event",
		VenueLatitude:  &latitude,
		VenueLongitude: &longitude,
	})
	if result.VenueLatitude == nil || *result.VenueLatitude != latitude || result.VenueLongitude == nil || *result.VenueLongitude != longitude {
		t.Fatalf("venue coordinates were not preserved: %v/%v", result.VenueLatitude, result.VenueLongitude)
	}
}
