package recommendations

import (
	"testing"

	"github.com/eventa/discovery-service/internal/index"
)

func point(latitude, longitude float64) *index.Content {
	return &index.Content{VenueLatitude: &latitude, VenueLongitude: &longitude}
}

// TestRankCandidatesKeepsStoreOrderWithoutAnOrigin pins the untouched path:
// no origin means no distance anywhere and the store's candidate order is
// the answer order, whatever the scores say.
func TestRankCandidatesKeepsStoreOrderWithoutAnOrigin(t *testing.T) {
	ids := []string{"third", "first", "second"}
	resolved := map[string]*index.Content{
		"first":  point(6.6, 3.4),
		"second": point(6.4, 3.3),
		"third":  point(6.5, 3.4),
	}
	similarities := map[string]float32{"first": 0.9, "second": 0.8, "third": 0.7}

	ranked := rankCandidates(ids, resolved, similarities, nil)
	if len(ranked) != 3 {
		t.Fatalf("got %d candidates, want 3", len(ranked))
	}
	for i, want := range ids {
		if ranked[i].eventID != want {
			t.Fatalf("position %d: got %s, want %s (store order)", i, ranked[i].eventID, want)
		}
		if ranked[i].distance != nil {
			t.Fatalf("position %d carries distance %v without an origin", i, *ranked[i].distance)
		}
	}
}

// TestRankCandidatesBlendsDistanceWithStoreScore pins the blend: a nearer
// event overtakes a marginally better semantic match, the ordering value is
// distance-weighted rather than raw kilometres, and every located candidate
// reports its distance.
func TestRankCandidatesBlendsDistanceWithStoreScore(t *testing.T) {
	origin := &Origin{Latitude: 6.5244, Longitude: 3.3792}
	nearLat, nearLon := 6.5694, 3.3792     // ~5 km
	farLat, farLon := 6.8844, 3.3792       // ~40 km
	beyondLat, beyondLon := 7.0644, 3.3792 // ~60 km, past the scale

	ids := []string{"far", "beyond", "near"}
	resolved := map[string]*index.Content{
		"near":   point(nearLat, nearLon),
		"far":    point(farLat, farLon),
		"beyond": point(beyondLat, beyondLon),
	}
	similarities := map[string]float32{"near": 0.70, "far": 0.72, "beyond": 0.50}

	ranked := rankCandidates(ids, resolved, similarities, origin)
	if len(ranked) != 3 {
		t.Fatalf("got %d candidates, want 3", len(ranked))
	}
	if ranked[0].eventID != "near" || ranked[1].eventID != "far" || ranked[2].eventID != "beyond" {
		t.Fatalf("got order [%s %s %s], want distance-blended [near far beyond]",
			ranked[0].eventID, ranked[1].eventID, ranked[2].eventID)
	}
	previous := -1e9
	for _, candidate := range ranked {
		if candidate.distance == nil {
			t.Fatalf("%s carries no distance although its venue has coordinates", candidate.eventID)
		}
		if *candidate.distance <= previous {
			t.Fatalf("%s distance %v does not increase", candidate.eventID, *candidate.distance)
		}
		previous = *candidate.distance
	}
	if *ranked[2].distance < distanceScaleKm {
		t.Fatalf("the beyond candidate sits %v km away, want at least the %v km scale", *ranked[2].distance, distanceScaleKm)
	}
}

// TestRankCandidatesRanksCoordinatelessCandidatesOnStoreScoreAlone pins the
// no-coordinates rule in both directions: a coordinate-less event neither
// crashes the blend nor wins or loses by default — it competes on
// similarity alone while located events gain at most the bounded share.
func TestRankCandidatesRanksCoordinatelessCandidatesOnStoreScoreAlone(t *testing.T) {
	origin := &Origin{Latitude: 6.5244, Longitude: 3.3792}
	similarities := map[string]float32{"plain": 0.90, "located": 0.70, "atOrigin": 0.90}
	plain := &index.Content{Title: "No coordinates"}
	located := &index.Content{VenueLatitude: floatPointer(6.5694), VenueLongitude: floatPointer(3.3792), Title: "Five kilometres"}
	atOrigin := &index.Content{VenueLatitude: floatPointer(6.5244), VenueLongitude: floatPointer(3.3792), Title: "At the origin"}

	t.Run("a better semantic match without coordinates still outranks a mediocre near one", func(t *testing.T) {
		ranked := rankCandidates([]string{"located", "plain"}, map[string]*index.Content{
			"plain": plain, "located": located,
		}, similarities, origin)
		if ranked[0].eventID != "plain" {
			t.Fatalf("got %s first, want the coordinate-less candidate ranked on similarity alone", ranked[0].eventID)
		}
		if ranked[0].distance != nil || ranked[1].distance == nil {
			t.Fatal("expected nil distance for the coordinate-less candidate and a distance for the located one")
		}
	})

	t.Run("a strong near match still overtakes the coordinate-less candidate", func(t *testing.T) {
		ranked := rankCandidates([]string{"plain", "atOrigin"}, map[string]*index.Content{
			"plain": plain, "atOrigin": atOrigin,
		}, similarities, origin)
		if ranked[0].eventID != "atOrigin" {
			t.Fatalf("got %s first, want the at-origin candidate after its bounded proximity boost", ranked[0].eventID)
		}
	})
}

// TestProximityOfIsOneAtTheOriginAndZeroFromTheScale pins the distance
// signal's shape: linear falloff, clamped, never negative.
func TestProximityOfIsOneAtTheOriginAndZeroFromTheScale(t *testing.T) {
	cases := []struct {
		distance float64
		want     float64
	}{
		{0, 1},
		{distanceScaleKm / 2, 0.5},
		{distanceScaleKm, 0},
		{distanceScaleKm * 4, 0},
	}
	for _, c := range cases {
		if got := proximityOf(c.distance); got != c.want {
			t.Fatalf("proximityOf(%v) = %v, want %v", c.distance, got, c.want)
		}
	}
}

// TestHaversineKmMeasuresKnownSpans sanity-checks the distance primitive on
// the equator-ish spans the seeded dataset uses.
func TestHaversineKmMeasuresKnownSpans(t *testing.T) {
	if got := haversineKm(6.5244, 3.3792, 6.5244, 3.3792); got != 0 {
		t.Fatalf("same point measures %v km, want 0", got)
	}
	// One hundredth of a degree of latitude is a bit over a kilometre.
	got := haversineKm(6.5244, 3.3792, 6.5344, 3.3792)
	if got < 1.0 || got > 1.3 {
		t.Fatalf("0.01 degrees of latitude measures %v km, want about 1.1", got)
	}
}

func floatPointer(value float64) *float64 { return &value }
