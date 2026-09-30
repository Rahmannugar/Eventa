package integration

import (
	"context"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	discoveryv1 "github.com/eventa/discovery-service/internal/gen/eventa/discovery/v1"
	"github.com/eventa/discovery-service/internal/logging"
	"github.com/eventa/discovery-service/internal/semantic"
	"github.com/eventa/discovery-service/internal/semantic/ahnlich"
	"github.com/eventa/discovery-service/internal/similar"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newSimilarHandler builds the handler over the real projection, the real
// store, and the real Event Service.
func newSimilarHandler(t *testing.T, pool *pgxpool.Pool, store *ahnlich.Client) *similar.Handler {
	t.Helper()
	return similar.NewHandler(
		semantic.NewRepository(pool),
		store,
		realEvents(t),
		logging.New("SimilarHandlerTest"),
	)
}

func TestAnUnknownEventIsNotFound(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	handler := newSimilarHandler(t, pool, realStore(t))

	_, err := handler.SimilarEvents(context.Background(), &discoveryv1.SimilarEventsRequest{
		EventId: uniqueEventID(t),
	})
	if status.Code(err) != codes.NotFound {
		t.Errorf("error = %v, want NotFound", err)
	}
}

func TestACancelledEventIsNotFound(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	eventID := uniqueEventID(t)
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO discovery_event_index (event_id, status, cancelled_at)
		VALUES ($1, 'cancelled', now())
	`, eventID); err != nil {
		t.Fatalf("seed cancelled row: %v", err)
	}

	handler := newSimilarHandler(t, pool, realStore(t))
	_, err := handler.SimilarEvents(context.Background(), &discoveryv1.SimilarEventsRequest{EventId: eventID})
	if status.Code(err) != codes.NotFound {
		t.Errorf("error = %v, want NotFound for a cancelled source event", err)
	}
}

func TestAnInvalidEventIdIsRejected(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	handler := newSimilarHandler(t, pool, realStore(t))

	_, err := handler.SimilarEvents(context.Background(), &discoveryv1.SimilarEventsRequest{EventId: "not-a-uuid"})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("error = %v, want InvalidArgument", err)
	}
}

// The source event's query text and the text the indexer stored must be the
// same string, or the nearest neighbours of an event are decided in a vector
// space the event itself never entered.
func TestTheSourceEventsOwnTextFindsItInTheRealStore(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	store := realStore(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	eventID := uniqueEventID(t)
	seedPublished(t, pool, eventID)
	if err := store.IndexEvent(ctx, eventID, expectedText(), semantic.Attribute{
		Key:   semantic.EventAttributeKey,
		Value: eventID,
	}); err != nil {
		t.Fatalf("index event: %v", err)
	}
	t.Cleanup(func() { _ = store.RemoveEvent(context.Background(), eventID) })

	candidates, err := store.Search(ctx, expectedText(), 10)
	if err != nil {
		t.Fatalf("search store: %v", err)
	}
	for _, candidate := range candidates {
		if candidate.EventID == eventID {
			return
		}
	}
	t.Fatalf("source event is not among the %d candidates its own text produced", len(candidates))
}

// A full answer runs the projection read, the embed, the store search, and
// Event Service's confirmation against the real boundaries, and never echoes
// the event asked about back as similar to itself.
func TestAFullSimilarAnswerExcludesTheSourceEvent(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	store := realStore(t)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	eventID := uniqueEventID(t)
	seedPublished(t, pool, eventID)
	if err := store.IndexEvent(ctx, eventID, expectedText(), semantic.Attribute{
		Key:   semantic.EventAttributeKey,
		Value: eventID,
	}); err != nil {
		t.Fatalf("index event: %v", err)
	}
	t.Cleanup(func() { _ = store.RemoveEvent(context.Background(), eventID) })

	handler := newSimilarHandler(t, pool, store)
	response, err := handler.SimilarEvents(ctx, &discoveryv1.SimilarEventsRequest{
		EventId: eventID,
		Limit:   5,
	})
	if err != nil {
		t.Fatalf("similar events: %v", err)
	}
	if response.GetEventId() != eventID {
		t.Errorf("event id = %q, want %q", response.GetEventId(), eventID)
	}
	if len(response.GetEvents()) > 5 {
		t.Errorf("returned %d events, want at most the requested limit", len(response.GetEvents()))
	}
	for _, event := range response.GetEvents() {
		if event.GetEventId() == eventID {
			t.Errorf("source event returned as similar to itself: %v", event)
		}
		if event.GetTitle() == "" {
			t.Errorf("returned an event without a title: %v", event)
		}
	}
}
