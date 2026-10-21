package recommendations

import (
	"context"
	"math"
	"testing"

	"github.com/google/uuid"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	discoveryv1 "github.com/eventa/discovery-service/internal/gen/eventa/discovery/v1"
	"github.com/eventa/discovery-service/internal/logging"
)

// TestRecommendEventsRejectsAMalformedOriginWithoutReadingState proves the
// origin is validated before any dependency is touched: a nil handler would
// panic rather than return a status if validation happened later.
func TestRecommendEventsRejectsAMalformedOriginWithoutReadingState(t *testing.T) {
	handler := NewHandler(nil, nil, nil, nil, logging.New("RecommendationsHandler"))
	attendeeID := uuid.NewString()

	cases := []struct {
		name   string
		origin *discoveryv1.Origin
	}{
		{"latitude above the pole", &discoveryv1.Origin{Latitude: 91, Longitude: 0}},
		{"longitude past the antimeridian", &discoveryv1.Origin{Latitude: 0, Longitude: -181}},
		{"latitude that is not a number", &discoveryv1.Origin{Latitude: math.NaN(), Longitude: 0}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := handler.RecommendEvents(context.Background(), &discoveryv1.RecommendEventsRequest{
				AttendeeId: attendeeID,
				Origin:     c.origin,
			})
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("got code %s, want %s", status.Code(err), codes.InvalidArgument)
			}
		})
	}
}
