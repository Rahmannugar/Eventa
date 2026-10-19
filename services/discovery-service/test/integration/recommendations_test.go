package integration

import (
	"context"
	"log/slog"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/eventa/discovery-service/internal/behaviour"
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
// record, the real behaviour evidence, the real store, and the real Event
// Service.
func newRecommendationsHandler(t *testing.T, pool *pgxpool.Pool) *recommendations.Handler {
	t.Helper()
	return recommendations.NewHandler(
		interests.NewRepository(pool),
		behaviour.NewRepository(pool),
		realStore(t),
		realEvents(t),
		logging.New("RecommendationsHandler"),
	)
}

// seedBehaviour records one behaviour row straight through Discovery's own
// table, the same shape the ingest transaction writes.
func seedBehaviour(t *testing.T, pool *pgxpool.Pool, attendeeID, eventID, kind string, occurredAt time.Time) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO discovery_attendee_behaviour (attendee_id, event_id, kind, occurred_at)
		VALUES ($1, $2, $3, $4)
	`, attendeeID, eventID, kind, occurredAt); err != nil {
		t.Fatalf("seed behaviour row: %v", err)
	}
}

// captureHandler records structured log records so a test can assert on the
// counts the handler publishes, which is how the cold-start gate and the
// store interaction become observable without changing production code.
type captureHandler struct {
	mu      sync.Mutex
	records []capturedRecord
}

type capturedRecord struct {
	message    string
	attributes map[string]any
}

func (h *captureHandler) Enabled(context.Context, slog.Level) bool { return true }

func (h *captureHandler) Handle(_ context.Context, record slog.Record) error {
	attributes := map[string]any{}
	record.Attrs(func(attribute slog.Attr) bool {
		attributes[attribute.Key] = attribute.Value.Any()
		return true
	})
	h.mu.Lock()
	h.records = append(h.records, capturedRecord{message: record.Message, attributes: attributes})
	h.mu.Unlock()
	return nil
}

func (h *captureHandler) WithAttrs([]slog.Attr) slog.Handler { return h }
func (h *captureHandler) WithGroup(string) slog.Handler      { return h }

func (h *captureHandler) last(message string) (map[string]any, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for i := len(h.records) - 1; i >= 0; i-- {
		if h.records[i].message == message {
			return h.records[i].attributes, true
		}
	}
	return nil, false
}

// count reads a numeric attribute, which slog boxes as either int or int64
// depending on how the value entered the record.
func count(t *testing.T, attributes map[string]any, key string) int {
	t.Helper()
	switch value := attributes[key].(type) {
	case int:
		return value
	case int64:
		return int(value)
	default:
		t.Fatalf("%s = %v, want a numeric count", key, attributes[key])
		return 0
	}
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

	candidates, err := store.Search(ctx, semantic.BuildPreferences([]string{"Jazz", "music"}, nil, nil), 10)
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

func TestAnAttendeeWithNothingSavedGetsTheColdStartAnswer(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetPreferences(t, pool)
	capture := &captureHandler{}
	handler := recommendations.NewHandler(
		interests.NewRepository(pool),
		behaviour.NewRepository(pool),
		realStore(t),
		realEvents(t),
		slog.New(capture),
	)
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
	attributes, ok := capture.last("recommendations_completed")
	if !ok {
		t.Fatal("no completion record was published")
	}
	if reason := attributes["reason"]; reason != "no_preferences" {
		t.Errorf("reason = %v, want no_preferences", reason)
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

// The attended evidence read, rendered the way the handler renders it, must
// place the attended event itself among the nearest neighbours in the real
// store: that is the whole claim that behaviour can shape the query.
func TestAttendedEvidenceRendersAQueryThatFindsItsEventInTheRealStore(t *testing.T) {
	pool := startMigratedDatabase(t)
	store := realStore(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	eventID := uniqueEventID(t)
	attendeeID := uuid.New()
	seedPublished(t, pool, eventID)
	seedBehaviour(t, pool, attendeeID.String(), eventID, "attended", time.Now())
	if err := store.IndexEvent(ctx, eventID, expectedText(), semantic.Attribute{
		Key:   semantic.EventAttributeKey,
		Value: eventID,
	}); err != nil {
		t.Fatalf("index event: %v", err)
	}
	t.Cleanup(func() { _ = store.RemoveEvent(context.Background(), eventID) })

	rows, err := behaviour.NewRepository(pool).Evidence(ctx, attendeeID, behaviour.KindAttended, 12)
	if err != nil {
		t.Fatalf("read evidence: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("read %d evidence rows, want 1", len(rows))
	}
	events := make([]semantic.PreferenceEvent, 0, len(rows))
	for _, row := range rows {
		city := ""
		if row.VenueCity != nil {
			city = *row.VenueCity
		}
		events = append(events, semantic.PreferenceEvent{
			Title: row.Title, Categories: row.Categories, City: city,
		})
	}

	candidates, err := store.Search(ctx, semantic.BuildPreferences(nil, events, nil), 10)
	if err != nil {
		t.Fatalf("search store: %v", err)
	}
	for _, candidate := range candidates {
		if candidate.EventID == eventID {
			return
		}
	}
	t.Fatalf("attended event is not among the %d candidates its evidence produced", len(candidates))
}

// A behaviour-only attendee must reach the store instead of stopping at the
// cold-start gate. The completion record proves it: the evidence was read,
// the rendered query went to the real store, and candidates came back.
func TestABehaviourOnlyAttendeeProceedsPastColdStart(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetPreferences(t, pool)
	capture := &captureHandler{}
	store := realStore(t)
	handler := recommendations.NewHandler(
		interests.NewRepository(pool),
		behaviour.NewRepository(pool),
		store,
		realEvents(t),
		slog.New(capture),
	)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	eventID := uniqueEventID(t)
	attendeeID := uuid.New().String()
	seedPublished(t, pool, eventID)
	seedBehaviour(t, pool, attendeeID, eventID, "attended", time.Now())
	if err := store.IndexEvent(ctx, eventID, expectedText(), semantic.Attribute{
		Key:   semantic.EventAttributeKey,
		Value: eventID,
	}); err != nil {
		t.Fatalf("index event: %v", err)
	}
	t.Cleanup(func() { _ = store.RemoveEvent(context.Background(), eventID) })

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

	attributes, ok := capture.last("recommendations_completed")
	if !ok {
		t.Fatal("no completion record was published")
	}
	if reason, present := attributes["reason"]; present {
		t.Fatalf("reason = %v, want the request to run past the cold-start gate", reason)
	}
	if attended := count(t, attributes, "attended"); attended != 1 {
		t.Errorf("attended = %d, want 1", attended)
	}
	if candidates := count(t, attributes, "candidates"); candidates < 1 {
		t.Errorf("candidates = %d, want at least 1 from the real store", candidates)
	}
}
