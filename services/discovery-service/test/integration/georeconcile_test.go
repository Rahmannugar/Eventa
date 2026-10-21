package integration

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eventa/discovery-service/internal/georeconcile"
	"github.com/eventa/discovery-service/internal/index"
)

type geoStub struct {
	content *index.Content
	err     error
}

func (s *geoStub) GetPublishedContent(context.Context, string) (*index.Content, error) {
	return s.content, s.err
}

func insertPublishedWithoutCoordinates(t *testing.T, pool *pgxpool.Pool, eventID string) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO discovery_event_index (event_id, status, title)
		VALUES ($1, 'published', 'Awaiting Coordinates')
	`, eventID)
	if err != nil {
		t.Fatalf("insert published row: %v", err)
	}
}

func coordinateRow(t *testing.T, pool *pgxpool.Pool, eventID string) (latitude, longitude *float64) {
	t.Helper()
	err := pool.QueryRow(context.Background(), `
		SELECT venue_latitude, venue_longitude FROM discovery_event_index WHERE event_id = $1
	`, eventID).Scan(&latitude, &longitude)
	if err != nil {
		t.Fatalf("read coordinates: %v", err)
	}
	return latitude, longitude
}

func refreshRows(t *testing.T, pool *pgxpool.Pool) (count int, attempts int) {
	t.Helper()
	err := pool.QueryRow(context.Background(), `
		SELECT count(*), COALESCE(max(attempt_count), 0) FROM discovery_venue_geo_refresh
	`).Scan(&count, &attempts)
	if err != nil {
		t.Fatalf("read refresh rows: %v", err)
	}
	return count, attempts
}

// TestVenueGeoReconcileStoresCoordinatesFromLookup proves the backfill path:
// a published row without coordinates is refreshed through the Event Service
// lookup and keeps its other index content untouched.
func TestVenueGeoReconcileStoresCoordinatesFromLookup(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	eventID := uuid.NewString()
	insertPublishedWithoutCoordinates(t, pool, eventID)

	latitude, longitude := 6.5244, 3.3792
	reconciler := georeconcile.NewReconciler(
		georeconcile.NewRepository(pool),
		&geoStub{content: &index.Content{VenueLatitude: &latitude, VenueLongitude: &longitude}},
		10,
	)
	reconciler.Pass(context.Background())

	gotLat, gotLon := coordinateRow(t, pool, eventID)
	if gotLat == nil || *gotLat != latitude || gotLon == nil || *gotLon != longitude {
		t.Fatalf("expected coordinates %v/%v, got %v/%v", latitude, longitude, gotLat, gotLon)
	}
	if count, _ := refreshRows(t, pool); count != 0 {
		t.Fatalf("expected refresh work to be completed, %d rows remain", count)
	}
}

// TestVenueGeoReconcileClosesWhenLookupServesNoCoordinates proves the terminal
// path: Event Service authoritatively serves a venue without coordinates, so
// the work closes instead of retrying forever.
func TestVenueGeoReconcileClosesWhenLookupServesNoCoordinates(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	eventID := uuid.NewString()
	insertPublishedWithoutCoordinates(t, pool, eventID)

	reconciler := georeconcile.NewReconciler(
		georeconcile.NewRepository(pool),
		&geoStub{content: &index.Content{VenueName: "Coordinate-less Hall"}},
		10,
	)
	reconciler.Pass(context.Background())

	gotLat, gotLon := coordinateRow(t, pool, eventID)
	if gotLat != nil || gotLon != nil {
		t.Fatalf("expected coordinates to stay null, got %v/%v", gotLat, gotLon)
	}
	if count, _ := refreshRows(t, pool); count != 0 {
		t.Fatalf("expected refresh work to close, %d rows remain", count)
	}
}

// TestVenueGeoReconcileSpendsAttemptWhenLookupFails proves a failing lookup
// is retried bounded work: the row survives with one spent attempt and a
// future due time instead of hot-looping or disappearing.
func TestVenueGeoReconcileSpendsAttemptWhenLookupFails(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	eventID := uuid.NewString()
	insertPublishedWithoutCoordinates(t, pool, eventID)

	reconciler := georeconcile.NewReconciler(
		georeconcile.NewRepository(pool),
		&geoStub{err: errors.New("lookup unavailable")},
		10,
	)
	reconciler.Pass(context.Background())

	gotLat, gotLon := coordinateRow(t, pool, eventID)
	if gotLat != nil || gotLon != nil {
		t.Fatalf("expected coordinates to stay null, got %v/%v", gotLat, gotLon)
	}
	count, attempts := refreshRows(t, pool)
	if count != 1 || attempts != 1 {
		t.Fatalf("expected one row with one spent attempt, got count=%d attempts=%d", count, attempts)
	}
}

// TestVenueGeoReconcileEnqueuesOnlyPublishedRowsMissingCoordinates proves the
// enqueue is precise: cancelled rows and rows that already carry coordinates
// are never scheduled for refresh.
func TestVenueGeoReconcileEnqueuesOnlyPublishedRowsMissingCoordinates(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetIndex(t, pool)
	missing := uuid.NewString()
	withCoordinates := uuid.NewString()
	cancelled := uuid.NewString()
	insertPublishedWithoutCoordinates(t, pool, missing)

	latitude, longitude := 5.6037, -0.1870
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO discovery_event_index (event_id, status, title, venue_latitude, venue_longitude)
		VALUES ($1, 'published', 'Already Located', $2, $3)
	`, withCoordinates, latitude, longitude); err != nil {
		t.Fatalf("insert located row: %v", err)
	}
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO discovery_event_index (event_id, status, title)
		VALUES ($1, 'cancelled', 'Cancelled')
	`, cancelled); err != nil {
		t.Fatalf("insert cancelled row: %v", err)
	}

	repository := georeconcile.NewRepository(pool)
	reconciler := georeconcile.NewReconciler(repository, &geoStub{err: errors.New("unused")}, 10)
	reconciler.Pass(context.Background())

	var enqueued int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM discovery_venue_geo_refresh`,
	).Scan(&enqueued); err != nil {
		t.Fatalf("count enqueued: %v", err)
	}
	if enqueued != 1 {
		t.Fatalf("expected only the coordinate-less published row enqueued, got %d", enqueued)
	}
}
