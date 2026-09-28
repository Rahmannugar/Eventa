package integration

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/discovery-service/internal/index"
)

const (
	indexedEventID     = "3c2d1f0a-5e7b-4344-8a3f-9c2d1f0a5e7b"
	firstCancelID      = "1f0a5e7b-3c44-4a3f-9c2d-0b9a6e2f2b1e"
	secondCancelID     = "5a8c2e41-7d90-4b6f-91c3-2e7d4a91c3f5"
	replayedPublishVer = 7
)

type resolverStub struct {
	content *index.Content
	err     error
	calls   int
}

func (s *resolverStub) GetPublishedContent(context.Context, string) (*index.Content, error) {
	s.calls++
	return s.content, s.err
}

func sampleContent() *index.Content {
	return &index.Content{
		Title:            "Harbour Lights Festival",
		Description:      "A weekend of live music on the waterfront.",
		StartsAt:         time.Date(2026, 10, 3, 18, 0, 0, 0, time.UTC),
		EndsAt:           time.Date(2026, 10, 5, 23, 0, 0, 0, time.UTC),
		TimeZone:         "Europe/London",
		Categories:       []string{"music", "festival"},
		VenueName:        "North Dock",
		VenueCity:        "Bristol",
		VenueCountryCode: "GB",
	}
}

func record(t *testing.T, fact map[string]any) []byte {
	t.Helper()
	body, err := json.Marshal(fact)
	if err != nil {
		t.Fatalf("marshal fact: %v", err)
	}
	return body
}

func publishedRecord(t *testing.T) []byte {
	t.Helper()
	return record(t, map[string]any{
		"type":        index.PublishedType,
		"eventId":     indexedEventID,
		"version":     replayedPublishVer,
		"publishedAt": "2026-09-27T19:17:45Z",
	})
}

func cancelledRecord(t *testing.T, messageID string) []byte {
	t.Helper()
	return record(t, map[string]any{
		"type":        index.CancelledType,
		"eventId":     indexedEventID,
		"messageId":   messageID,
		"cancelledAt": "2026-09-28T08:03:12Z",
	})
}

type row struct {
	status     string
	version    sql.NullInt64
	title      sql.NullString
	city       sql.NullString
	categories []string
	cancelled  sql.NullTime
}

func readIndexRow(t *testing.T, pool *pgxpool.Pool) row {
	t.Helper()
	var got row
	err := pool.QueryRow(context.Background(), `
		SELECT status, version, title, venue_city, categories, cancelled_at
		FROM discovery_event_index WHERE event_id = $1
	`, indexedEventID).Scan(&got.status, &got.version, &got.title, &got.city, &got.categories, &got.cancelled)
	if err != nil {
		t.Fatalf("read index row: %v", err)
	}
	return got
}

func inboxCount(t *testing.T, pool *pgxpool.Pool, factType, dedupeKey string) int {
	t.Helper()
	var count int
	err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM discovery_event_inbox WHERE event_type = $1 AND message_id = $2
	`, factType, dedupeKey).Scan(&count)
	if err != nil {
		t.Fatalf("read inbox: %v", err)
	}
	return count
}

// The inbox claim, the resolve, and the index write must land together: a
// published event that was resolved becomes discoverable with the content
// Event Service actually serves.
func TestPublishedFactIndexesResolvedContentAndItsClaim(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	resolver := &resolverStub{content: sampleContent()}

	outcome, err := index.NewIngest(pool, resolver, nil).Ingest(context.Background(), publishedRecord(t))
	if err != nil {
		t.Fatalf("Ingest error = %v", err)
	}
	if outcome != index.OutcomeProcessed {
		t.Fatalf("outcome = %s, want %s", outcome, index.OutcomeProcessed)
	}

	got := readIndexRow(t, pool)
	if got.status != "published" {
		t.Errorf("status = %s, want published", got.status)
	}
	if got.version.Int64 != replayedPublishVer {
		t.Errorf("version = %d, want %d", got.version.Int64, replayedPublishVer)
	}
	if !got.title.Valid || got.title.String != "Harbour Lights Festival" {
		t.Errorf("title = %+v, want Harbour Lights Festival", got.title)
	}
	if !got.city.Valid || got.city.String != "Bristol" {
		t.Errorf("venue_city = %+v, want Bristol", got.city)
	}
	if len(got.categories) != 2 || got.categories[0] != "music" {
		t.Errorf("categories = %v, want [music festival]", got.categories)
	}
	if got.cancelled.Valid {
		t.Error("cancelled_at is set for a published event")
	}
	if count := inboxCount(t, pool, index.PublishedType, indexedEventID); count != 1 {
		t.Errorf("inbox rows = %d, want 1", count)
	}
}

// A replayed publication must not re-run the resolve or overwrite the content
// already stored, which is what makes the consumer safe to restart mid-stream.
func TestReplayedPublishedFactIsADuplicateAndKeepsFirstContent(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	resolver := &resolverStub{content: sampleContent()}
	ingest := index.NewIngest(pool, resolver, nil)

	if _, err := ingest.Ingest(context.Background(), publishedRecord(t)); err != nil {
		t.Fatalf("first Ingest error = %v", err)
	}
	resolver.content = &index.Content{Title: "A Different Title"}

	outcome, err := ingest.Ingest(context.Background(), publishedRecord(t))
	if err != nil {
		t.Fatalf("second Ingest error = %v", err)
	}
	if outcome != index.OutcomeDuplicate {
		t.Fatalf("outcome = %s, want %s", outcome, index.OutcomeDuplicate)
	}
	if resolver.calls != 1 {
		t.Errorf("resolver calls = %d, want 1", resolver.calls)
	}
	if title := readIndexRow(t, pool).title; !title.Valid || title.String != "Harbour Lights Festival" {
		t.Errorf("title = %+v, want the first content", title)
	}
	if count := inboxCount(t, pool, index.PublishedType, indexedEventID); count != 1 {
		t.Errorf("inbox rows = %d, want 1", count)
	}
}

// An event cancelled before Discovery ever saw its publish still has to
// disappear from results, so the tombstone is written without a predecessor.
func TestCancellationTombstonesAnEventNeverPublished(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)

	outcome, err := index.NewIngest(pool, &resolverStub{}, nil).Ingest(context.Background(), cancelledRecord(t, firstCancelID))
	if err != nil {
		t.Fatalf("Ingest error = %v", err)
	}
	if outcome != index.OutcomeProcessed {
		t.Fatalf("outcome = %s, want %s", outcome, index.OutcomeProcessed)
	}

	got := readIndexRow(t, pool)
	if got.status != "cancelled" {
		t.Errorf("status = %s, want cancelled", got.status)
	}
	if !got.cancelled.Valid {
		t.Error("cancelled_at is null")
	}
	if got.title.Valid {
		t.Errorf("title = %s, want null", got.title.String)
	}
	if count := inboxCount(t, pool, index.CancelledType, firstCancelID); count != 1 {
		t.Errorf("inbox rows = %d, want 1", count)
	}
}

func TestCancellationAfterPublicationKeepsResolvedContent(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	ingest := index.NewIngest(pool, &resolverStub{content: sampleContent()}, nil)

	if _, err := ingest.Ingest(context.Background(), publishedRecord(t)); err != nil {
		t.Fatalf("publish error = %v", err)
	}
	outcome, err := ingest.Ingest(context.Background(), cancelledRecord(t, firstCancelID))
	if err != nil {
		t.Fatalf("cancel error = %v", err)
	}
	if outcome != index.OutcomeProcessed {
		t.Fatalf("outcome = %s, want %s", outcome, index.OutcomeProcessed)
	}

	got := readIndexRow(t, pool)
	if got.status != "cancelled" {
		t.Errorf("status = %s, want cancelled", got.status)
	}
	if !got.title.Valid || got.title.String != "Harbour Lights Festival" {
		t.Errorf("title = %+v, want the resolved content retained", got.title)
	}
}

// Two cancellations of one event are separate records against the outbox, so
// each one must be claimed independently rather than collapsing into one.
func TestEachCancellationIsClaimedSeparately(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	ingest := index.NewIngest(pool, &resolverStub{}, nil)

	for _, messageID := range []string{firstCancelID, secondCancelID} {
		outcome, err := ingest.Ingest(context.Background(), cancelledRecord(t, messageID))
		if err != nil {
			t.Fatalf("Ingest(%s) error = %v", messageID, err)
		}
		if outcome != index.OutcomeProcessed {
			t.Fatalf("outcome = %s, want %s for %s", outcome, index.OutcomeProcessed, messageID)
		}
	}
	if count := inboxCount(t, pool, index.CancelledType, firstCancelID); count != 1 {
		t.Errorf("first inbox rows = %d, want 1", count)
	}
	if count := inboxCount(t, pool, index.CancelledType, secondCancelID); count != 1 {
		t.Errorf("second inbox rows = %d, want 1", count)
	}
}

// Event Service not serving a published event is a durable answer, not a
// transient failure: the fact is applied and the absent content is recorded as
// absent rather than invented or retried forever.
func TestPublishedEventEventNoLongerServesIsRecordedWithoutContent(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	resolver := &resolverStub{err: index.ErrContentUnavailable}

	outcome, err := index.NewIngest(pool, resolver, nil).Ingest(context.Background(), publishedRecord(t))
	if err != nil {
		t.Fatalf("Ingest error = %v", err)
	}
	if outcome != index.OutcomeContentUnavailable {
		t.Fatalf("outcome = %s, want %s", outcome, index.OutcomeContentUnavailable)
	}

	got := readIndexRow(t, pool)
	if got.status != "published" {
		t.Errorf("status = %s, want published", got.status)
	}
	if got.title.Valid {
		t.Errorf("title = %s, want null", got.title.String)
	}
	if count := inboxCount(t, pool, index.PublishedType, indexedEventID); count != 1 {
		t.Errorf("inbox rows = %d, want 1", count)
	}
}

// A genuine resolve failure must roll the claim back, otherwise the fact would
// be recorded as handled and its content would never be retried.
func TestResolveFailureRollsBackTheClaim(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	resolver := &resolverStub{err: errors.New("event service unavailable")}

	if _, err := index.NewIngest(pool, resolver, nil).Ingest(context.Background(), publishedRecord(t)); err == nil {
		t.Fatal("Ingest error = nil, want a resolve failure")
	}
	if count := inboxCount(t, pool, index.PublishedType, indexedEventID); count != 0 {
		t.Errorf("inbox rows = %d, want 0 after a failed resolve", count)
	}
	var rows int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM discovery_event_index WHERE event_id = $1`, indexedEventID).Scan(&rows); err != nil {
		t.Fatalf("count index rows: %v", err)
	}
	if rows != 0 {
		t.Errorf("index rows = %d, want 0 after a failed resolve", rows)
	}
}
