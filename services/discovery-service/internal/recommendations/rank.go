package recommendations

import (
	"math"
	"sort"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	discoveryv1 "github.com/eventa/discovery-service/internal/gen/eventa/discovery/v1"
	"github.com/eventa/discovery-service/internal/index"
)

const (
	// proximityWeight is the share of a located candidate's blended score the
	// distance signal may move; the rest stays the store's similarity. The
	// two scales never meet raw: similarity is the store's unitless score and
	// proximity is a bounded 0..1 factor derived from kilometres, so the
	// weight is the only place they combine.
	proximityWeight = 0.2
	// distanceScaleKm is where the proximity factor reaches zero. It keeps
	// same-city events distinguishable on the seeded dataset (jitter spans up
	// to ~10 km) while a venue in another city contributes nothing, instead
	// of letting raw kilometres dominate a cosine score.
	distanceScaleKm = 50.0
	// earthRadiusKm is the mean radius used for the great-circle distance.
	earthRadiusKm = 6371.0
)

// Origin is the validated point an attendee ranks from.
type Origin struct {
	Latitude  float64
	Longitude float64
}

// originFromRequest lifts and validates the optional ranking point. An
// absent origin keeps the store's own order; a malformed one is an invalid
// argument rather than a quietly unranked answer. NaN and infinities are
// rejected explicitly because they slip through range comparisons.
func originFromRequest(raw *discoveryv1.Origin) (*Origin, error) {
	if raw == nil {
		return nil, nil
	}
	latitude, longitude := raw.GetLatitude(), raw.GetLongitude()
	if math.IsNaN(latitude) || math.IsInf(latitude, 0) ||
		math.IsNaN(longitude) || math.IsInf(longitude, 0) ||
		latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 {
		return nil, status.Error(codes.InvalidArgument, "invalid origin")
	}
	return &Origin{Latitude: latitude, Longitude: longitude}, nil
}

// rankedCandidate is one resolved event with the scores the answer is
// ordered by. distance stays nil for an unlocated event or a request with
// no origin, and nil distance means the candidate ranks on similarity alone.
type rankedCandidate struct {
	eventID    string
	content    *index.Content
	similarity float64
	distance   *float64
}

// score is the ordering value: the store's similarity alone, or with the
// proximity factor blended in for a candidate whose distance we know.
func (c rankedCandidate) score() float64 {
	if c.distance == nil {
		return c.similarity
	}
	return (1-proximityWeight)*c.similarity + proximityWeight*proximityOf(*c.distance)
}

// rankCandidates resolves store candidates against Event Service's content
// and produces the answer order. Without an origin the store's order is kept
// exactly. With one, candidates keep their store score and those that carry
// coordinates gain a bounded proximity factor, so a modest distance signal
// reorders near matches without swallowing the semantic ranking; candidates
// Event Service dropped never appear, and a candidate without coordinates
// competes on similarity alone rather than winning or losing by default.
func rankCandidates(ids []string, resolved map[string]*index.Content, similarities map[string]float32, origin *Origin) []rankedCandidate {
	ranked := make([]rankedCandidate, 0, len(ids))
	for _, eventID := range ids {
		content := resolved[eventID]
		if content == nil {
			continue
		}
		candidate := rankedCandidate{
			eventID:    eventID,
			content:    content,
			similarity: float64(similarities[eventID]),
		}
		if origin != nil && content.VenueLatitude != nil && content.VenueLongitude != nil {
			distance := haversineKm(origin.Latitude, origin.Longitude, *content.VenueLatitude, *content.VenueLongitude)
			candidate.distance = &distance
		}
		ranked = append(ranked, candidate)
	}
	if origin == nil {
		return ranked
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		return ranked[i].score() > ranked[j].score()
	})
	return ranked
}

// proximityOf maps a distance onto 0..1: at the origin it is 1 and from the
// scale distance on it is 0, falling linearly in between.
func proximityOf(distance float64) float64 {
	proximity := 1 - distance/distanceScaleKm
	if proximity < 0 {
		return 0
	}
	return proximity
}

// haversineKm is the great-circle distance between two decimal-degree
// points, used because the resolved content already carries both endpoints
// and a per-result database round trip would buy no accuracy the ranking
// needs.
func haversineKm(fromLatitude, fromLongitude, toLatitude, toLongitude float64) float64 {
	const radians = math.Pi / 180
	deltaLatitude := (toLatitude - fromLatitude) * radians
	deltaLongitude := (toLongitude - fromLongitude) * radians
	halfLat := math.Sin(deltaLatitude / 2)
	halfLon := math.Sin(deltaLongitude / 2)
	a := halfLat*halfLat +
		math.Cos(fromLatitude*radians)*math.Cos(toLatitude*radians)*halfLon*halfLon
	return 2 * earthRadiusKm * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}
