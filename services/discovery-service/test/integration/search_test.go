package integration

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/discovery-service/internal/search"
)

type searchFixture struct {
	pool *pgxpool.Pool
}

// seed writes one index row exactly as the ingest path leaves it, so the
// query is exercised against real storage rather than a fake.
func (s *searchFixture) seed(t *testing.T, status string, title *string, categories []string, startsAt *time.Time) string {
	t.Helper()

	eventID := uuid.NewString()
	var err error
	switch status {
	case "published":
		_, err = s.pool.Exec(context.Background(), `
			INSERT INTO discovery_event_index (event_id, status, version, published_at, title, categories, starts_at)
			VALUES ($1, 'published', 1, now(), $2, $3, $4)
		`, eventID, title, categories, startsAt)
	default:
		_, err = s.pool.Exec(context.Background(), `
			INSERT INTO discovery_event_index (event_id, status, cancelled_at, updated_at)
			VALUES ($1, 'cancelled', now(), now())
		`, eventID)
	}
	if err != nil {
		t.Fatalf("seed %s row: %v", status, err)
	}
	return eventID
}

func text(value string) *string        { return &value }
func clock(value time.Time) *time.Time { return &value }

func searchFixtureFor(t *testing.T) *searchFixture {
	t.Helper()

	pool := startMigratedDatabase(t)
	// The test database is persistent, so a search test starts from an empty
	// projection instead of inheriting rows an earlier test left behind.
	if _, err := pool.Exec(context.Background(),
		`TRUNCATE discovery_event_inbox, discovery_event_index`); err != nil {
		t.Fatalf("clear projection: %v", err)
	}
	return &searchFixture{pool: pool}
}

func TestSearchReturnsOnlyPublishedRowsDiscoveryStillHoldsContentFor(t *testing.T) {
	fixture := searchFixtureFor(t)
	starts := clock(time.Date(2026, 10, 1, 10, 0, 0, 0, time.UTC))

	streetFood := fixture.seed(t, "published", text("Lagos Street Food Festival"), []string{"food", "festival"}, starts)
	fixture.seed(t, "published", text("Afrobeats Live"), []string{"music"},
		clock(time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)))
	fixture.seed(t, "cancelled", nil, nil, nil)
	fixture.seed(t, "published", nil, []string{"food"}, starts)

	repository := search.NewRepository(fixture.pool)
	filters, err := search.Parse("", nil, "", "", nil, 0, 0)
	if err != nil {
		t.Fatalf("parse filters: %v", err)
	}

	rows, total, err := repository.Search(context.Background(), filters)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if total != 2 {
		t.Fatalf("got total %d, want 2", total)
	}
	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(rows))
	}
	if rows[0].EventID.String() != streetFood {
		t.Fatalf("got first row %s, want %s ordered by start time", rows[0].EventID, streetFood)
	}
	if rows[0].Title != "Lagos Street Food Festival" {
		t.Fatalf("got title %q", rows[0].Title)
	}
}

func TestSearchMatchesTextCaseInsensitivelyAndTreatsWildcardsAsLiterals(t *testing.T) {
	fixture := searchFixtureFor(t)
	starts := clock(time.Date(2026, 10, 1, 10, 0, 0, 0, time.UTC))
	fixture.seed(t, "published", text("Lagos Street Food Festival"), []string{"food"}, starts)
	fixture.seed(t, "published", text("Builders Meetup: Shipping with AI"), []string{"tech"}, starts)

	repository := search.NewRepository(fixture.pool)

	t.Run("case insensitive substring", func(t *testing.T) {
		filters, _ := search.Parse("STREET FOOD", nil, "", "", nil, 0, 0)
		rows, total, err := repository.Search(context.Background(), filters)
		if err != nil {
			t.Fatalf("search: %v", err)
		}
		if total != 1 || len(rows) != 1 {
			t.Fatalf("got total %d rows %d, want 1 and 1", total, len(rows))
		}
		if rows[0].Title != "Lagos Street Food Festival" {
			t.Fatalf("got title %q", rows[0].Title)
		}
	})

	t.Run("percent is literal", func(t *testing.T) {
		filters, _ := search.Parse("festival%", nil, "", "", nil, 0, 0)
		_, total, err := repository.Search(context.Background(), filters)
		if err != nil {
			t.Fatalf("search: %v", err)
		}
		if total != 0 {
			t.Fatalf("got total %d, want 0 because the trailing percent is literal", total)
		}
	})
}

func TestSearchFiltersByCategoryAndSchedule(t *testing.T) {
	fixture := searchFixtureFor(t)
	october := clock(time.Date(2026, 10, 1, 10, 0, 0, 0, time.UTC))
	november := clock(time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC))

	foodEvent := fixture.seed(t, "published", text("Lagos Street Food Festival"), []string{"food", "festival"}, october)
	musicEvent := fixture.seed(t, "published", text("Afrobeats Live"), []string{"music"}, november)

	repository := search.NewRepository(fixture.pool)

	t.Run("any listed category matches", func(t *testing.T) {
		filters, _ := search.Parse("", []string{"music", "food"}, "", "", nil, 0, 0)
		_, total, err := repository.Search(context.Background(), filters)
		if err != nil {
			t.Fatalf("search: %v", err)
		}
		if total != 2 {
			t.Fatalf("got total %d, want 2", total)
		}
	})

	t.Run("category matching ignores case", func(t *testing.T) {
		filters, _ := search.Parse("", []string{"MUSIC"}, "", "", nil, 0, 0)
		rows, total, err := repository.Search(context.Background(), filters)
		if err != nil {
			t.Fatalf("search: %v", err)
		}
		if total != 1 || len(rows) != 1 || rows[0].EventID.String() != musicEvent {
			t.Fatalf("got total %d rows %v, want only %s", total, rows, musicEvent)
		}
	})

	t.Run("unknown category narrows to nothing", func(t *testing.T) {
		filters, _ := search.Parse("", []string{"astronomy"}, "", "", nil, 0, 0)
		_, total, err := repository.Search(context.Background(), filters)
		if err != nil {
			t.Fatalf("search: %v", err)
		}
		if total != 0 {
			t.Fatalf("got total %d, want 0", total)
		}
	})

	t.Run("schedule bounds are inclusive", func(t *testing.T) {
		from := october.Add(time.Second).Format(time.RFC3339)
		filters, _ := search.Parse("", nil, from, "", nil, 0, 0)
		rows, total, err := repository.Search(context.Background(), filters)
		if err != nil {
			t.Fatalf("search: %v", err)
		}
		if total != 1 || len(rows) != 1 {
			t.Fatalf("got total %d rows %d, want 1 and 1", total, len(rows))
		}
		if rows[0].EventID.String() != musicEvent {
			t.Fatalf("got %s, want %s", rows[0].EventID, musicEvent)
		}
	})

	t.Run("end bound keeps only earlier events", func(t *testing.T) {
		to := october.Format(time.RFC3339)
		filters, _ := search.Parse("", nil, "", to, nil, 0, 0)
		rows, _, err := repository.Search(context.Background(), filters)
		if err != nil {
			t.Fatalf("search: %v", err)
		}
		if len(rows) != 1 || rows[0].EventID.String() != foodEvent {
			t.Fatalf("got %d rows, want only %s", len(rows), foodEvent)
		}
	})
}

func TestSearchPaginatesInAStableOrder(t *testing.T) {
	fixture := searchFixtureFor(t)
	start := time.Date(2026, 10, 1, 10, 0, 0, 0, time.UTC)
	var first string
	for i := 0; i < 3; i++ {
		id := fixture.seed(t, "published", text("Event "+string(rune('A'+i))), []string{"music"}, clock(start.Add(time.Duration(i)*time.Hour)))
		if i == 0 {
			first = id
		}
	}

	repository := search.NewRepository(fixture.pool)
	pageOne, err := search.Parse("", nil, "", "", nil, 2, 0)
	if err != nil {
		t.Fatalf("parse page one: %v", err)
	}
	pageTwo, err := search.Parse("", nil, "", "", nil, 2, 2)
	if err != nil {
		t.Fatalf("parse page two: %v", err)
	}

	firstPage, total, err := repository.Search(context.Background(), pageOne)
	if err != nil {
		t.Fatalf("search page one: %v", err)
	}
	secondPage, _, err := repository.Search(context.Background(), pageTwo)
	if err != nil {
		t.Fatalf("search page two: %v", err)
	}

	if total != 3 || len(firstPage) != 2 || len(secondPage) != 1 {
		t.Fatalf("got total %d with pages %d and %d, want 3 with 2 and 1", total, len(firstPage), len(secondPage))
	}
	if firstPage[0].EventID.String() != first {
		t.Fatalf("got first row %s, want the earliest event %s", firstPage[0].EventID, first)
	}
}

// seedWithCoordinates writes a published row that carries a venue point, the
// shape Event Service's coordinates take after the reconcile path stores them.
func seedWithCoordinates(t *testing.T, pool *pgxpool.Pool, title string, startsAt *time.Time, latitude, longitude float64) string {
	t.Helper()

	eventID := uuid.NewString()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO discovery_event_index (event_id, status, version, published_at, title, categories, starts_at, venue_latitude, venue_longitude)
		VALUES ($1, 'published', 1, now(), $2, $3, $4, $5, $6)
	`, eventID, title, []string{"meetup"}, startsAt, latitude, longitude)
	if err != nil {
		t.Fatalf("seed coordinate row: %v", err)
	}
	return eventID
}

type proximityFixture struct {
	pool       *pgxpool.Pool
	repository *search.Repository
	latitude   float64
	longitude  float64
	near       string
	mid        string
	far        string
	coordless  string
}

// proximityFixtureFor seeds four events on one start time around one point:
// the clock ties are deliberate, so only the distance key can order them.
func proximityFixtureFor(t *testing.T) *proximityFixture {
	t.Helper()

	fixture := searchFixtureFor(t)
	starts := clock(time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC))
	latitude, longitude := 6.5244, 3.3792 // Lagos

	return &proximityFixture{
		pool:       fixture.pool,
		repository: search.NewRepository(fixture.pool),
		latitude:   latitude,
		longitude:  longitude,
		near:       seedWithCoordinates(t, fixture.pool, "Nearby Meetup", starts, latitude+0.01, longitude),
		mid:        seedWithCoordinates(t, fixture.pool, "Midtown Meetup", starts, latitude+0.05, longitude),
		far:        seedWithCoordinates(t, fixture.pool, "Outskirts Conference", starts, latitude+0.5, longitude),
		coordless:  fixture.seed(t, "published", text("Coordless Gathering"), []string{"meetup"}, starts),
	}
}

func TestSearchOrdersByDistanceWithinTheRadiusAndSkipsVenuesWithoutCoordinates(t *testing.T) {
	fixture := proximityFixtureFor(t)
	filters, err := search.Parse("", nil, "", "", &search.Near{
		Latitude:  fixture.latitude,
		Longitude: fixture.longitude,
		RadiusKm:  10,
	}, 0, 0)
	if err != nil {
		t.Fatalf("parse filters: %v", err)
	}

	rows, total, err := fixture.repository.Search(context.Background(), filters)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if total != 2 || len(rows) != 2 {
		t.Fatalf("got total %d rows %d, want 2 and 2 — the far venue and the coordinate-less venue must fall out", total, len(rows))
	}
	if rows[0].EventID.String() != fixture.near || rows[1].EventID.String() != fixture.mid {
		t.Fatalf("got order [%s %s], want distance order [%s %s]",
			rows[0].EventID, rows[1].EventID, fixture.near, fixture.mid)
	}
	if rows[0].DistanceKm == nil || *rows[0].DistanceKm < 0.5 || *rows[0].DistanceKm > 2 {
		t.Fatalf("got near distance %v, want about 1.1 km", rows[0].DistanceKm)
	}
	if rows[1].DistanceKm == nil || *rows[1].DistanceKm < 4 || *rows[1].DistanceKm > 7 {
		t.Fatalf("got mid distance %v, want about 5.6 km", rows[1].DistanceKm)
	}
	if *rows[0].DistanceKm >= *rows[1].DistanceKm {
		t.Fatalf("got distances %v then %v, want strictly increasing", *rows[0].DistanceKm, *rows[1].DistanceKm)
	}
}

func TestSearchWithoutANearClauseReturnsVenuesWithoutCoordinatesAndNoDistance(t *testing.T) {
	fixture := proximityFixtureFor(t)
	filters, err := search.Parse("", nil, "", "", nil, 0, 0)
	if err != nil {
		t.Fatalf("parse filters: %v", err)
	}

	rows, total, err := fixture.repository.Search(context.Background(), filters)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if total != 4 || len(rows) != 4 {
		t.Fatalf("got total %d rows %d, want all 4 — without a clause coordinates are irrelevant", total, len(rows))
	}
	sawCoordless := false
	for i := range rows {
		if rows[i].DistanceKm != nil {
			t.Fatalf("row %d carries distance %v without a near clause", i, *rows[i].DistanceKm)
		}
		if rows[i].EventID.String() == fixture.coordless {
			sawCoordless = true
		}
	}
	if !sawCoordless {
		t.Fatal("the coordinate-less venue must remain searchable without a proximity clause")
	}
}
