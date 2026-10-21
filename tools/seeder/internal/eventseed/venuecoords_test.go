package eventseed

import (
	"math"
	"strconv"
	"testing"

	"github.com/google/uuid"
)

// The backfill is only rerunnable if the point it computes never changes:
// every claim of the same event must produce the byte-identical coordinates,
// or a second run would move a venue that is no longer coordinateless anyway.
func TestVenueBackfillPointIsStableForTheSameEvent(t *testing.T) {
	eventID := uuid.MustParse("d5e0e6ce-0000-4000-8000-000000000001")
	for _, home := range cities {
		wantLatitude, wantLongitude := venuePointFor(home, eventID)
		for range 16 {
			latitude, longitude := venuePointFor(home, eventID)
			if latitude != wantLatitude || longitude != wantLongitude {
				t.Fatalf(
					"venuePointFor(%q, %s) = (%v, %v), want (%v, %v)",
					home.Name, eventID, latitude, longitude, wantLatitude, wantLongitude,
				)
			}
		}
	}
}

// Placed venues must stay near their city, otherwise distance ordering stops
// resembling a real audience travelling to an event.
func TestVenueBackfillPointStaysWithinTenKilometresOfItsCity(t *testing.T) {
	for _, home := range cities {
		for i := range 500 {
			eventID := uuid.NewSHA1(uuid.NameSpaceURL, []byte("eventa/seeder/venue-test/"+strconv.Itoa(i)))
			latitude, longitude := venuePointFor(home, eventID)
			if distance := distanceKm(home.Latitude, home.Longitude, latitude, longitude); distance > 10.01 {
				t.Fatalf("point for %q sits %.3f km from its centroid, want at most 10 km", home.Name, distance)
			}
		}
	}
}

func distanceKm(latitudeA, longitudeA, latitudeB, longitudeB float64) float64 {
	const earthRadiusKm = 6371.0
	const degreesToRadians = math.Pi / 180

	dLatitude := (latitudeB - latitudeA) * degreesToRadians
	dLongitude := (longitudeB - longitudeA) * degreesToRadians
	halfChord := math.Sin(dLatitude/2)*math.Sin(dLatitude/2) +
		math.Cos(latitudeA*degreesToRadians)*math.Cos(latitudeB*degreesToRadians)*
			math.Sin(dLongitude/2)*math.Sin(dLongitude/2)
	return earthRadiusKm * 2 * math.Atan2(math.Sqrt(halfChord), math.Sqrt(1-halfChord))
}
