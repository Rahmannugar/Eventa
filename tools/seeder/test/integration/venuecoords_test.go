package integration

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/tools/seeder/internal/eventseed"
)

const backfillOffset = 810000

// The backfill's contract: it places exactly the coordinateless venues whose
// city the seed knows, leaves an already-placed venue untouched, leaves an
// unknown city coordinateless, and settles — a rerun places nothing.
func TestVenueBackfillPlacesPoolCityVenuesOnce(t *testing.T) {
	pool := startEventDatabase(t)
	ctx := context.Background()

	now := time.Now().UTC()
	admin := uuid.MustParse("0d0f7d2e-0000-4000-8000-000000000002")
	events := generateBatch(testSeed, backfillOffset, 8, now, admin)
	ids := eventIDs(events)
	t.Cleanup(func() { removeEvents(t, pool, ids) })
	insertBatch(t, pool, events)

	const coordless = 6
	if _, err := pool.Exec(ctx,
		`UPDATE event_venues SET latitude = NULL, longitude = NULL WHERE event_id = ANY($1)`,
		ids[:coordless+1],
	); err != nil {
		t.Fatalf("clear coordinates: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE event_venues SET city = 'Reykjavik' WHERE event_id = $1`,
		ids[coordless],
	); err != nil {
		t.Fatalf("move one venue outside the pool: %v", err)
	}

	control := ids[coordless+1]
	var controlLatitude, controlLongitude float64
	if err := pool.QueryRow(ctx,
		`SELECT latitude, longitude FROM event_venues WHERE event_id = $1`,
		control,
	).Scan(&controlLatitude, &controlLongitude); err != nil {
		t.Fatalf("read the already-placed venue: %v", err)
	}

	placed, batches := backfillAll(t, pool, 3)
	if placed != coordless {
		t.Fatalf("first run placed %d venues, want %d", placed, coordless)
	}
	if batches != 3 {
		t.Fatalf("first run took %d batches, want 3 (claims of 3, 3, and 0)", batches)
	}

	var stillCoordinateless int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM event_venues WHERE event_id = ANY($1) AND latitude IS NULL`,
		ids,
	).Scan(&stillCoordinateless); err != nil {
		t.Fatalf("count coordinateless venues: %v", err)
	}
	if stillCoordinateless != 1 {
		t.Fatalf("%d venues stayed coordinateless, want only the city outside the pool", stillCoordinateless)
	}
	var leftover uuid.UUID
	if err := pool.QueryRow(ctx,
		`SELECT event_id FROM event_venues WHERE event_id = ANY($1) AND latitude IS NULL`,
		ids,
	).Scan(&leftover); err != nil {
		t.Fatalf("read the leftover venue: %v", err)
	}
	if leftover != ids[coordless] {
		t.Fatalf("leftover venue %s, want the Reykjavik row %s", leftover, ids[coordless])
	}

	var latitude, longitude float64
	if err := pool.QueryRow(ctx,
		`SELECT latitude, longitude FROM event_venues WHERE event_id = $1`,
		control,
	).Scan(&latitude, &longitude); err != nil {
		t.Fatalf("re-read the already-placed venue: %v", err)
	}
	if latitude != controlLatitude || longitude != controlLongitude {
		t.Fatalf(
			"already-placed venue moved to (%v, %v), want (%v, %v)",
			latitude, longitude, controlLatitude, controlLongitude,
		)
	}

	if rerun, _ := backfillAll(t, pool, 3); rerun != 0 {
		t.Fatalf("second run placed %d venues, want 0", rerun)
	}
}

// backfillAll runs the venue backfill the way the subcommand does — one
// transaction per batch until a claim returns nothing.
func backfillAll(t *testing.T, pool *pgxpool.Pool, batchSize int) (int64, int) {
	t.Helper()
	ctx := context.Background()

	var (
		placed  int64
		batches int
	)
	for {
		if batches > 64 {
			t.Fatal("the backfill never settled")
		}
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatalf("begin: %v", err)
		}
		changed, err := eventseed.BackfillVenueCoordinates(ctx, tx, batchSize)
		if err != nil {
			_ = tx.Rollback(ctx)
			t.Fatalf("backfill batch: %v", err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatalf("commit: %v", err)
		}
		batches++
		placed += changed
		if changed == 0 {
			return placed, batches
		}
	}
}
