package integration

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/tools/seeder/internal/eventseed"
)

const (
	testSeed   = int64(42424242)
	testOffset = 800000
	testCount  = 12
)

// TestSeededEventsArePublishableAndCarryTheirOutboxRow is the slice's contract:
// rows land where Event Service reads them, every one of them keeps sellable
// inventory (the rule that keeps an event visible to authority queries), every
// one carries the publication fact Debezium relays, and rerunning the same
// range adds nothing.
func TestSeededEventsArePublishableAndCarryTheirOutboxRow(t *testing.T) {
	pool := startEventDatabase(t)
	ctx := context.Background()

	now := time.Now().UTC()
	admin := uuid.MustParse("0d0f7d2e-0000-4000-8000-000000000001")
	events := generateBatch(testSeed, testOffset, testCount, now, admin)
	ids := eventIDs(events)

	t.Cleanup(func() { removeEvents(t, pool, ids) })

	if written := insertBatch(t, pool, events); written != testCount {
		t.Fatalf("first run inserted %d events, want %d", written, testCount)
	}

	var eligible int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM events e
		WHERE e.id = ANY($1)
		  AND e.status = 'published'
		  AND e.retired_at IS NULL
		  AND e.starts_at > now()
		  AND EXISTS (
		    SELECT 1 FROM event_ticket_currencies c
		    JOIN event_ticket_types t ON t.ticket_currency_id = c.id
		    WHERE c.event_id = e.id
		      AND t.retired_at IS NULL
		      AND t.sales_end_at > now()
		      AND t.capacity - t.reserved_quantity - t.sold_quantity > 0
		  )`, ids).Scan(&eligible); err != nil {
		t.Fatalf("check publishable and stocked events: %v", err)
	}
	if eligible != testCount {
		t.Fatalf("%d of %d seeded events are published, upcoming, and stocked", eligible, testCount)
	}

	counts := sideTableCounts(t, pool, ids)
	if counts.categories < testCount || counts.categories > testCount*3 {
		t.Fatalf("categories = %d, want 1-3 per event", counts.categories)
	}
	if counts.venues != testCount {
		t.Fatalf("venues = %d, want one per event", counts.venues)
	}
	if counts.currencies != testCount {
		t.Fatalf("currencies = %d, want one per event", counts.currencies)
	}
	if counts.ticketTypes < testCount || counts.ticketTypes > testCount*3 {
		t.Fatalf("ticket types = %d, want 1-3 per event", counts.ticketTypes)
	}
	if counts.publications != testCount {
		t.Fatalf("publication rows = %d, want one per event", counts.publications)
	}

	assertPublicationFacts(t, pool, ids)

	// A rerun of the same range must commit nothing new: ids are derived from
	// the seed and index, so the conflict clauses swallow every row.
	if written := insertBatch(t, pool, events); written != 0 {
		t.Fatalf("rerun inserted %d events, want 0", written)
	}
	if rerun := sideTableCounts(t, pool, ids); rerun != counts {
		t.Fatalf("rerun changed the stored rows: %+v -> %+v", counts, rerun)
	}
}

// TestAFailedBatchLeavesNoRowsBehind proves the transactional claim: a batch
// that trips a schema constraint commits nothing, so a failed seed never
// leaves an event without its inventory or its outbox row.
func TestAFailedBatchLeavesNoRowsBehind(t *testing.T) {
	pool := startEventDatabase(t)
	ctx := context.Background()

	now := time.Now().UTC()
	admin := uuid.MustParse("0d0f7d2e-0000-4000-8000-000000000001")
	events := generateBatch(testSeed+1, testOffset, 6, now, admin)
	events[3].Title = strings.Repeat("x", 200) // over the 160 character title rule
	ids := eventIDs(events)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if _, err := eventseed.InsertBatch(ctx, tx, events); err == nil {
		t.Fatal("an over-long title must be rejected by the schema")
	} else if err := tx.Rollback(ctx); err != nil {
		t.Fatalf("rollback: %v", err)
	}

	var stored int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM events WHERE id = ANY($1)`, ids).Scan(&stored); err != nil {
		t.Fatalf("count surviving events: %v", err)
	}
	if stored != 0 {
		t.Fatalf("%d events survived a failed batch, want 0", stored)
	}
	var publications int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM event_publication_outbox WHERE event_id = ANY($1)`, ids).Scan(&publications); err != nil {
		t.Fatalf("count surviving publication rows: %v", err)
	}
	if publications != 0 {
		t.Fatalf("%d publication rows survived a failed batch, want 0", publications)
	}
}

type sideCounts struct {
	categories, venues, currencies, ticketTypes, publications int
}

func sideTableCounts(t *testing.T, pool *pgxpool.Pool, ids []uuid.UUID) sideCounts {
	t.Helper()
	ctx := context.Background()

	var counts sideCounts
	queries := []struct {
		target *int
		query  string
	}{
		{&counts.categories, `SELECT count(*) FROM event_categories WHERE event_id = ANY($1)`},
		{&counts.venues, `SELECT count(*) FROM event_venues WHERE event_id = ANY($1)`},
		{&counts.currencies, `SELECT count(*) FROM event_ticket_currencies WHERE event_id = ANY($1)`},
		{&counts.ticketTypes, `SELECT count(*) FROM event_ticket_types WHERE ticket_currency_id IN (SELECT id FROM event_ticket_currencies WHERE event_id = ANY($1))`},
		{&counts.publications, `SELECT count(*) FROM event_publication_outbox WHERE event_id = ANY($1) AND event_type = 'event.published.v1'`},
	}
	for _, step := range queries {
		if err := pool.QueryRow(ctx, step.query, ids).Scan(step.target); err != nil {
			t.Fatalf("count rows: %v", err)
		}
	}
	return counts
}

// assertPublicationFacts reads the outbox payload back the way a consumer
// would: the fact must name its event, carry an RFC 3339 timestamp, agree with
// the row's version, and sit on the aggregate Debezium routes to the lifecycle
// topic.
func assertPublicationFacts(t *testing.T, pool *pgxpool.Pool, ids []uuid.UUID) {
	t.Helper()
	ctx := context.Background()

	rows, err := pool.Query(ctx, `
		SELECT e.id, e.version, p.aggregate_type, p.payload
		FROM events e
		JOIN event_publication_outbox p ON p.event_id = e.id AND p.event_type = 'event.published.v1'
		WHERE e.id = ANY($1)`, ids)
	if err != nil {
		t.Fatalf("read publication rows: %v", err)
	}
	defer rows.Close()

	seen := 0
	for rows.Next() {
		var (
			id            uuid.UUID
			version       int32
			aggregateType string
			payload       []byte
		)
		if err := rows.Scan(&id, &version, &aggregateType, &payload); err != nil {
			t.Fatalf("scan publication row: %v", err)
		}
		seen++

		if aggregateType != eventseed.LifecycleAggregateType {
			t.Fatalf("event %s sits on aggregate %q, want %q", id, aggregateType, eventseed.LifecycleAggregateType)
		}
		fact, err := decodeFact(payload)
		if err != nil {
			t.Fatalf("event %s payload: %v", id, err)
		}
		if fact.Type != eventseed.PublishedEventType {
			t.Fatalf("event %s fact type %q", id, fact.Type)
		}
		if fact.EventID != id.String() {
			t.Fatalf("fact names event %s, want %s", fact.EventID, id)
		}
		if int32(fact.Version) != version {
			t.Fatalf("event %s: fact version %d does not match the row version %d", id, fact.Version, version)
		}
		if _, err := time.Parse(time.RFC3339, fact.PublishedAt); err != nil {
			t.Fatalf("event %s: publishedAt %q is not RFC 3339: %v", id, fact.PublishedAt, err)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate publication rows: %v", err)
	}
	if seen != len(ids) {
		t.Fatalf("read %d publication rows, want %d", seen, len(ids))
	}
}
