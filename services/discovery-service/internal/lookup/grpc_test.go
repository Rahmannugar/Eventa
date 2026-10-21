package lookup

import (
	"testing"
	"time"

	eventv1 "github.com/eventa/discovery-service/internal/gen/eventa/event/v1"
)

func publishedWithVenue(venue *eventv1.Venue) *eventv1.PublishedEvent {
	return &eventv1.PublishedEvent{
		EventId:     "2b7c9e1a-0000-4000-8000-000000000001",
		Title:       "Harbour Lights Festival",
		Description: "A weekend of live music.",
		StartsAt:    time.Date(2026, 10, 3, 18, 0, 0, 0, time.UTC).Format(time.RFC3339),
		EndsAt:      time.Date(2026, 10, 5, 23, 0, 0, 0, time.UTC).Format(time.RFC3339),
		TimeZone:    "Europe/London",
		Categories:  []string{"music"},
		Venue:       venue,
	}
}

// TestContentFromPublishedCarriesVenueCoordinates pins the lookup mapping:
// the extended Venue contract's optional coordinates reach Discovery's
// content untouched, and their absence stays absence rather than zero.
func TestContentFromPublishedCarriesVenueCoordinates(t *testing.T) {
	latitude, longitude := 5.1532, -2.5885
	content, err := contentFromPublished("2b7c9e1a-0000-4000-8000-000000000001", publishedWithVenue(&eventv1.Venue{
		Name:          "North Dock",
		AddressLine_1: "1 Dock Road",
		City:          "Bristol",
		CountryCode:   "GB",
		Latitude:      &latitude,
		Longitude:     &longitude,
	}))
	if err != nil {
		t.Fatalf("contentFromPublished: %v", err)
	}
	if content.VenueLatitude == nil || *content.VenueLatitude != latitude {
		t.Fatalf("expected latitude %v, got %v", latitude, content.VenueLatitude)
	}
	if content.VenueLongitude == nil || *content.VenueLongitude != longitude {
		t.Fatalf("expected longitude %v, got %v", longitude, content.VenueLongitude)
	}
}

// TestContentFromPublishedKeepsMissingCoordinatesAsNil proves a venue without
// coordinates (a legacy or coordinate-less event) does not invent zeros.
func TestContentFromPublishedKeepsMissingCoordinatesAsNil(t *testing.T) {
	content, err := contentFromPublished("2b7c9e1a-0000-4000-8000-000000000001", publishedWithVenue(&eventv1.Venue{
		Name:          "Coordinate-less Hall",
		AddressLine_1: "1 Marina Road",
		City:          "Lagos",
		CountryCode:   "NG",
	}))
	if err != nil {
		t.Fatalf("contentFromPublished: %v", err)
	}
	if content.VenueLatitude != nil || content.VenueLongitude != nil {
		t.Fatalf("expected nil coordinates, got %v/%v", content.VenueLatitude, content.VenueLongitude)
	}
}
