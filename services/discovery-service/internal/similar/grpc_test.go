package similar

import (
	"context"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	discoveryv1 "github.com/eventa/discovery-service/internal/gen/eventa/discovery/v1"
	"github.com/eventa/discovery-service/internal/index"
	"github.com/eventa/discovery-service/internal/logging"
	"github.com/eventa/discovery-service/internal/ranking"
	"github.com/eventa/discovery-service/internal/semantic"
)

// fakeSource stands in for the Discovery projection.
type fakeSource struct {
	work  *semantic.Work
	err   error
	calls int
}

func (f *fakeSource) GetWork(context.Context, string) (*semantic.Work, error) {
	f.calls++
	return f.work, f.err
}

// fakeStore stands in for the vector store and records the query it was asked.
type fakeStore struct {
	candidates []semantic.Candidate
	err        error
	query      string
	limit      int
	calls      int
}

func (f *fakeStore) Search(_ context.Context, query string, limit int) ([]semantic.Candidate, error) {
	f.calls++
	f.query = query
	f.limit = limit
	return f.candidates, f.err
}
func (f *fakeStore) EnsureStore(context.Context) error { return nil }
func (f *fakeStore) IndexEvent(context.Context, string, string, ...semantic.Attribute) error {
	return nil
}
func (f *fakeStore) RemoveEvent(context.Context, string) error { return nil }
func (f *fakeStore) Contains(context.Context, string) (bool, error) {
	return false, nil
}
func (f *fakeStore) Ping(context.Context) error { return nil }
func (f *fakeStore) Close() error               { return nil }

// fakeResolver stands in for Event Service's authority over the candidates.
type fakeResolver struct {
	resolved map[string]*index.Content
	err      error
	ids      []string
}

func (f *fakeResolver) ListRecommendableEvents(_ context.Context, eventIDs []string) (map[string]*index.Content, error) {
	f.ids = eventIDs
	return f.resolved, f.err
}

func publishedSource() *semantic.Work {
	return &semantic.Work{
		EventID:    "1d29185a-ba65-491f-8bd8-1cbc54b85630",
		Desired:    "index",
		HasText:    true,
		Title:      "Afrobeats Live: Waterfront Sessions",
		Desc:       "A headline Afrobeats bill on the Eko Atlantic waterfront.",
		Categories: []string{"Concert"},
		VenueName:  "Eko Atlantic",
		VenueCity:  "Lagos",
	}
}

func newTestHandler(source Source, store semantic.Store, events ranking.Resolver) *Handler {
	return NewHandler(source, store, events, logging.New("SimilarHandlerTest"))
}

func content(title string) *index.Content {
	startsAt := time.Date(2026, time.November, 21, 18, 0, 0, 0, time.UTC)
	return &index.Content{
		Title:       title,
		Description: "Neighbour event.",
		StartsAt:    startsAt,
		EndsAt:      startsAt.Add(4 * time.Hour),
		TimeZone:    "Africa/Lagos",
		Categories:  []string{"Concert"},
	}
}

func TestAnInvalidEventIdIsRejectedBeforeAnyLookup(t *testing.T) {
	source := &fakeSource{}
	handler := newTestHandler(source, &fakeStore{}, &fakeResolver{})

	_, err := handler.SimilarEvents(context.Background(), &discoveryv1.SimilarEventsRequest{EventId: "not-a-uuid"})

	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("error = %v, want InvalidArgument", err)
	}
	if source.calls != 0 {
		t.Errorf("source was read %d times, want none before validation", source.calls)
	}
}

func TestAnUnknownEventIsNotFoundWithoutQueryingTheStore(t *testing.T) {
	source := &fakeSource{work: nil}
	store := &fakeStore{}
	handler := newTestHandler(source, store, &fakeResolver{})

	_, err := handler.SimilarEvents(context.Background(), &discoveryv1.SimilarEventsRequest{
		EventId: "402e511f-d3f6-4ed9-909e-82d41a5d50cb",
	})

	if status.Code(err) != codes.NotFound {
		t.Errorf("error = %v, want NotFound", err)
	}
	if store.calls != 0 {
		t.Errorf("store was queried %d times, want none for an unknown event", store.calls)
	}
}

func TestACancelledEventIsNotFound(t *testing.T) {
	work := publishedSource()
	work.Desired = "remove"
	handler := newTestHandler(&fakeSource{work: work}, &fakeStore{}, &fakeResolver{})

	_, err := handler.SimilarEvents(context.Background(), &discoveryv1.SimilarEventsRequest{
		EventId: work.EventID,
	})

	if status.Code(err) != codes.NotFound {
		t.Errorf("error = %v, want NotFound for a cancelled source event", err)
	}
}

func TestTheSourceEventIsNeverReturnedAmongItsNeighbours(t *testing.T) {
	source := publishedSource()
	store := &fakeStore{candidates: []semantic.Candidate{
		{EventID: source.EventID, Similarity: 1},
		{EventID: "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", Similarity: 0.9},
		{EventID: "b7dfe1f2-0e0f-4d9a-8a1d-5f1c2b3a4e5f", Similarity: 0.8},
	}}
	resolver := &fakeResolver{resolved: map[string]*index.Content{
		source.EventID:                         content("Source"),
		"a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11": content("Afrobeats Rooftop Party"),
		"b7dfe1f2-0e0f-4d9a-8a1d-5f1c2b3a4e5f": content("Lagos Music Festival"),
	}}
	handler := newTestHandler(&fakeSource{work: source}, store, resolver)

	response, err := handler.SimilarEvents(context.Background(), &discoveryv1.SimilarEventsRequest{
		EventId: source.EventID,
		Limit:   5,
	})
	if err != nil {
		t.Fatalf("similar events: %v", err)
	}

	if len(response.GetEvents()) != 2 {
		t.Fatalf("returned %d events, want the two neighbours", len(response.GetEvents()))
	}
	for _, event := range response.GetEvents() {
		if event.GetEventId() == source.EventID {
			t.Errorf("source event returned as similar to itself: %v", event)
		}
	}
	if len(resolver.ids) != 2 {
		t.Errorf("resolved %d ids %v, want the neighbours without the source", len(resolver.ids), resolver.ids)
	}
	if store.query != semantic.Truncate(semantic.BuildText(
		source.Title, source.Desc, source.Categories, source.VenueName, source.VenueCity,
	)) {
		t.Errorf("query = %q, want the source event's own indexed text", store.query)
	}
}

func TestAnEventWithNoNeighboursReturnsAnEmptyAnswer(t *testing.T) {
	source := publishedSource()
	resolver := &fakeResolver{}
	handler := newTestHandler(
		&fakeSource{work: source},
		&fakeStore{candidates: []semantic.Candidate{{EventID: source.EventID, Similarity: 1}}},
		resolver,
	)

	response, err := handler.SimilarEvents(context.Background(), &discoveryv1.SimilarEventsRequest{
		EventId: source.EventID,
	})
	if err != nil {
		t.Fatalf("similar events: %v", err)
	}
	if len(response.GetEvents()) != 0 {
		t.Errorf("returned %d events, want none when the source is alone", len(response.GetEvents()))
	}
	if resolver.ids != nil {
		t.Errorf("resolved %v, want no lookup when there are no neighbours", resolver.ids)
	}
}

func TestAStoreFailureIsReportedAsUnavailable(t *testing.T) {
	source := publishedSource()
	resolver := &fakeResolver{}
	handler := newTestHandler(&fakeSource{work: source}, &fakeStore{err: status.Error(codes.Unavailable, "store down")}, resolver)

	_, err := handler.SimilarEvents(context.Background(), &discoveryv1.SimilarEventsRequest{
		EventId: source.EventID,
	})

	if status.Code(err) != codes.Unavailable {
		t.Errorf("error = %v, want Unavailable", err)
	}
	if resolver.ids != nil {
		t.Errorf("resolved %v, want no lookup when the store fails", resolver.ids)
	}
}
