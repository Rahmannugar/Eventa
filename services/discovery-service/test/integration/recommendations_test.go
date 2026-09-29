package integration

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	discoveryv1 "github.com/eventa/discovery-service/internal/gen/eventa/discovery/v1"
	"github.com/eventa/discovery-service/internal/interests"
	"github.com/eventa/discovery-service/internal/logging"
	"github.com/eventa/discovery-service/internal/lookup"
	"github.com/eventa/discovery-service/internal/recommendations"
	"github.com/eventa/discovery-service/internal/semantic"
)

// realEvents opens Discovery's client against the running Event Service. The
// recommendation cases are skipped without TEST_EVENT_GRPC_URL, so a machine
// without the service still runs the rest of the suite.
func realEvents(t *testing.T) *lookup.Client {
	t.Helper()

	address := os.Getenv("TEST_EVENT_GRPC_URL")
	if address == "" {
		t.Skip("TEST_EVENT_GRPC_URL is not set")
	}

	client, err := lookup.Dial(address, 5000)
	if err != nil {
		t.Fatalf("dial event service: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })
	return client
}

// resetPreferences clears the stored interests so one attendee's case never
// answers for another.
func resetPreferences(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), "TRUNCATE discovery_attendee_interests"); err != nil {
		t.Fatalf("truncate attendee interests: %v", err)
	}
}

// setInterests saves interests through the handler production serves, so a
// recommendation case starts from a written preference record.
func setInterests(t *testing.T, pool *pgxpool.Pool, attendeeID string, values []string) {
	t.Helper()
	handler := interests.NewHandler(interests.NewRepository(pool), logging.New("AttendeeInterestsHandler"))
	if _, err := handler.SetAttendeeInterests(context.Background(), &discoveryv1.SetAttendeeInterestsRequest{
		AttendeeId: attendeeID,
		Interests:  values,
	}); err != nil {
		t.Fatalf("set interests: %v", err)
	}
}

// newRecommendationsHandler builds the handler over the real preference
// record, the real store, and the real Event Service.
func newRecommendationsHandler(t *testing.T, pool *pgxpool.Pool) *recommendations.Handler {
	t.Helper()
	return recommendations.NewHandler(
		interests.NewRepository(pool),
		realStore(t),
		realEvents(t),
		logging.New("RecommendationsHandler"),
	)
}

func TestTheSavedInterestsMatchASeededEventInTheRealStore(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetPreferences(t, pool)
	store := realStore(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	eventID := uniqueEventID(t)
	text := "Jazz Night\nAn evening of live jazz on the waterfront.\nCategories: music\nVictoria Island, Lagos"
	if err := store.IndexEvent(ctx, eventID, text, semantic.Attribute{
		Key:   semantic.EventAttributeKey,
		Value: eventID,
	}); err != nil {
		t.Fatalf("index event: %v", err)
	}
	t.Cleanup(func() {
		_ = store.RemoveEvent(context.Background(), eventID)
	})

	candidates, err := store.Search(ctx, semantic.BuildPreferences([]string{"Jazz", "music"}), 10)
	if err != nil {
		t.Fatalf("search store: %v", err)
	}
	for _, candidate := range candidates {
		if candidate.EventID == eventID {
			return
		}
	}
	t.Fatalf("seeded event is not among the %d candidates the interests produced", len(candidates))
}

func TestCandidatesEventServiceHasNeverSeenAreNotRecommended(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetPreferences(t, pool)
	handler := newRecommendationsHandler(t, pool)
	attendeeID := uuid.New().String()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	setInterests(t, pool, attendeeID, []string{"Jazz", "music"})

	response, err := handler.RecommendEvents(ctx, &discoveryv1.RecommendEventsRequest{
		AttendeeId: attendeeID,
		Limit:      5,
	})
	if err != nil {
		t.Fatalf("recommend: %v", err)
	}
	if response.GetAttendeeId() != attendeeID {
		t.Errorf("attendee id = %q, want %q", response.GetAttendeeId(), attendeeID)
	}
	if len(response.GetEvents()) != 0 {
		t.Errorf("recommended %d events, want none: Event Service has never seen the test candidates", len(response.GetEvents()))
	}
}

func TestAnAttendeeWithoutSavedInterestsGetsNoRecommendations(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetPreferences(t, pool)
	handler := newRecommendationsHandler(t, pool)
	attendeeID := uuid.New().String()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	response, err := handler.RecommendEvents(ctx, &discoveryv1.RecommendEventsRequest{AttendeeId: attendeeID})
	if err != nil {
		t.Fatalf("recommend: %v", err)
	}
	if len(response.GetEvents()) != 0 {
		t.Errorf("recommended %d events, want none for a cold start", len(response.GetEvents()))
	}
}

func TestAnInvalidAttendeeIdIsRejectedBeforeAnyLookup(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetPreferences(t, pool)
	handler := newRecommendationsHandler(t, pool)

	_, err := handler.RecommendEvents(context.Background(), &discoveryv1.RecommendEventsRequest{
		AttendeeId: "not-a-uuid",
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("error = %v, want InvalidArgument", err)
	}
}

func TestEventServiceDropsIdsItHasNeverSeen(t *testing.T) {
	events := realEvents(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	resolved, err := events.ListRecommendableEvents(ctx, []string{
		uuid.New().String(),
		uuid.New().String(),
	})
	if err != nil {
		t.Fatalf("list recommendable events: %v", err)
	}
	if len(resolved) != 0 {
		t.Errorf("resolved %d events, want none", len(resolved))
	}
}
