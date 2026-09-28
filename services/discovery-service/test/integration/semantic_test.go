package integration

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/discovery-service/internal/semantic"
	"github.com/eventa/discovery-service/internal/semantic/ahnlich"
)

// The indexer and reconciler cases run against the real Ahnlich proxy and the
// real migrated database. Nothing here substitutes for either boundary.

func seedPublished(t *testing.T, pool *pgxpool.Pool, eventID string) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO discovery_event_index
			(event_id, status, version, published_at, title, description,
			 starts_at, ends_at, time_zone, categories, venue_name, venue_city, venue_country_code)
		VALUES ($1, 'published', 1, now(), 'Harbour Lights Festival',
			'A weekend of live music on the waterfront.',
			now(), now() + interval '2 days', 'Europe/London',
			ARRAY['music', 'festival'], 'North Dock', 'Bristol', 'GB')
		ON CONFLICT (event_id) DO UPDATE SET status = 'published'
	`, eventID)
	if err != nil {
		t.Fatalf("seed published event: %v", err)
	}
}

func expectedText() string {
	return semantic.Truncate(semantic.BuildText(
		"Harbour Lights Festival",
		"A weekend of live music on the waterfront.",
		[]string{"music", "festival"},
		"North Dock",
		"Bristol",
	))
}

func recordPending(t *testing.T, pool *pgxpool.Pool, eventID string) {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := semantic.RecordPendingIndex(ctx, tx, eventID, semantic.Hash(expectedText())); err != nil {
		t.Fatalf("record pending index: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
}

type semanticRow struct {
	status    string
	hash      string
	attempts  int
	lastError string
}

func readRow(t *testing.T, pool *pgxpool.Pool, eventID string) semanticRow {
	t.Helper()
	var row semanticRow
	err := pool.QueryRow(context.Background(), `
		SELECT status, COALESCE(content_hash, ''), attempts, COALESCE(last_error, '')
		FROM discovery_semantic_index WHERE event_id = $1
	`, eventID).Scan(&row.status, &row.hash, &row.attempts, &row.lastError)
	if errors.Is(err, pgx.ErrNoRows) {
		return semanticRow{}
	}
	if err != nil {
		t.Fatalf("read semantic row: %v", err)
	}
	return row
}

func TestAPublishedEventReachesTheStoreThroughTheIndexer(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	store := realStore(t)
	indexer := semantic.NewIndexer(semantic.NewRepository(pool), store)
	eventID := uniqueEventID(t)

	seedPublished(t, pool, eventID)
	recordPending(t, pool, eventID)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if err := indexer.Sync(ctx, eventID); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	row := readRow(t, pool, eventID)
	if row.status != "indexed" {
		t.Errorf("status = %q, want indexed", row.status)
	}
	if row.hash != semantic.Hash(expectedText()) {
		t.Errorf("hash = %q, want the hash of the text the store was given", row.hash)
	}
	if row.attempts != 0 || row.lastError != "" {
		t.Errorf("attempts/last_error = %d/%q, want a clean row", row.attempts, row.lastError)
	}

	present, err := store.Contains(ctx, eventID)
	if err != nil {
		t.Fatalf("Contains: %v", err)
	}
	if !present {
		t.Fatal("store does not hold the indexed event")
	}
}

func TestAnIndexedEventCostsNoStoreWriteOnRepetition(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	store := realStore(t)
	repository := semantic.NewRepository(pool)
	indexer := semantic.NewIndexer(repository, store)
	eventID := uniqueEventID(t)

	seedPublished(t, pool, eventID)
	recordPending(t, pool, eventID)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if err := indexer.Sync(ctx, eventID); err != nil {
		t.Fatalf("Sync: %v", err)
	}
	indexed := readRow(t, pool, eventID)

	// A second pass must observe convergence rather than re-embed: the event
	// cannot change under a row whose hash already matches.
	if err := indexer.Sync(ctx, eventID); err != nil {
		t.Fatalf("repeated Sync: %v", err)
	}
	repeated := readRow(t, pool, eventID)
	if repeated.status != "indexed" || repeated.hash != indexed.hash {
		t.Errorf("row after repetition = %+v, want the converged row", repeated)
	}
	if repeated.attempts != 0 || repeated.lastError != "" {
		t.Errorf("attempts/last_error = %d/%q, want a clean row", repeated.attempts, repeated.lastError)
	}
}

func TestTheReconcilerRestoresAnEntryTheStoreLost(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	store := realStore(t)
	repository := semantic.NewRepository(pool)
	indexer := semantic.NewIndexer(repository, store)
	eventID := uniqueEventID(t)

	seedPublished(t, pool, eventID)
	recordPending(t, pool, eventID)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	if err := indexer.Sync(ctx, eventID); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	// The snapshot-backed store can drop an entry after a restart without any
	// call having failed, leaving Discovery believing it is still searchable.
	if err := store.RemoveEvent(ctx, eventID); err != nil {
		t.Fatalf("RemoveEvent: %v", err)
	}
	if row := readRow(t, pool, eventID); row.status != "indexed" {
		t.Fatalf("status = %q, want indexed before the probe runs", row.status)
	}

	reconciler := semantic.NewReconciler(indexer, repository, store, 100, 0.1)
	reconciler.Pass(ctx)

	present, err := store.Contains(ctx, eventID)
	if err != nil {
		t.Fatalf("Contains: %v", err)
	}
	if !present {
		t.Fatal("reconciler did not restore the entry the store lost")
	}
	if row := readRow(t, pool, eventID); row.status != "indexed" || row.hash != semantic.Hash(expectedText()) {
		t.Errorf("row after reconciliation = %+v, want a converged row", row)
	}
}

func TestACancellationRemovesTheEventFromTheStore(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	store := realStore(t)
	repository := semantic.NewRepository(pool)
	indexer := semantic.NewIndexer(repository, store)
	eventID := uniqueEventID(t)

	seedPublished(t, pool, eventID)
	recordPending(t, pool, eventID)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if err := indexer.Sync(ctx, eventID); err != nil {
		t.Fatalf("Sync: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE discovery_event_index SET status = 'cancelled', cancelled_at = now()
		WHERE event_id = $1
	`, eventID); err != nil {
		t.Fatalf("cancel event: %v", err)
	}

	if err := indexer.Sync(ctx, eventID); err != nil {
		t.Fatalf("Sync after cancellation: %v", err)
	}

	present, err := store.Contains(ctx, eventID)
	if err != nil {
		t.Fatalf("Contains: %v", err)
	}
	if present {
		t.Fatal("store still holds a cancelled event")
	}
	if row := readRow(t, pool, eventID); row.status != "removed" {
		t.Errorf("status = %q, want removed", row.status)
	}
}

func TestAnOutageKeepsTheEventPendingForRetry(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	eventID := uniqueEventID(t)

	seedPublished(t, pool, eventID)
	recordPending(t, pool, eventID)

	// A closed port is a real transport failure, not a substituted store.
	broken, err := ahnlich.Dial("127.0.0.1:1", "eventa_events_test", testModel, 300)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = broken.Close() })

	indexer := semantic.NewIndexer(semantic.NewRepository(pool), broken)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := indexer.Sync(ctx, eventID); err == nil {
		t.Fatal("Sync = nil error, want a transport failure")
	}

	row := readRow(t, pool, eventID)
	if row.status != "pending_index" {
		t.Errorf("status = %q, want the event to stay pending", row.status)
	}
	if row.attempts != 1 {
		t.Errorf("attempts = %d, want 1", row.attempts)
	}
	if row.lastError == "" || row.lastError == "unknown" {
		t.Errorf("last_error = %q, want a bounded transport class", row.lastError)
	}
	if row.hash != semantic.Hash(expectedText()) {
		t.Errorf("hash = %q, want the pending content hash preserved", row.hash)
	}
}

func TestAPublishedRowWithoutATitleConvergesAsARemoval(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	repository := semantic.NewRepository(pool)
	eventID := uniqueEventID(t)

	if _, err := pool.Exec(context.Background(), `
		INSERT INTO discovery_event_index (event_id, status, title, categories)
		VALUES ($1, 'published', '', '{}')
	`, eventID); err != nil {
		t.Fatalf("seed untitled event: %v", err)
	}
	// The ingest transaction records the obligation before anything reads it.
	recordPending(t, pool, eventID)

	ctx := context.Background()
	work, err := repository.ListWork(ctx, 10)
	if err != nil {
		t.Fatalf("ListWork: %v", err)
	}
	if len(work) != 1 || work[0].Desired != "remove" {
		t.Fatalf("work = %+v, want one removal", work)
	}

	// The row has nothing to embed, so it must stop being reported as work
	// once it is recorded as removed.
	if err := repository.MarkRemoved(ctx, eventID); err != nil {
		t.Fatalf("MarkRemoved: %v", err)
	}
	work, err = repository.ListWork(ctx, 10)
	if err != nil {
		t.Fatalf("ListWork after removal: %v", err)
	}
	if len(work) != 0 {
		t.Errorf("work after removal = %+v, want none", work)
	}
	pending, err := repository.PendingCount(ctx)
	if err != nil {
		t.Fatalf("PendingCount: %v", err)
	}
	if pending != 0 {
		t.Errorf("pending = %d, want 0", pending)
	}
}
