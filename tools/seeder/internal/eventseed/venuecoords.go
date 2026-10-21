package eventseed

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"math/rand/v2"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// BackfillVenueCoordinates gives one batch of coordinateless venue rows their
// location. It claims rows whose city is one of the seed's city pool and whose
// coordinates are still absent, points each at a deterministic scatter around
// that city's centroid, and writes them back in the caller's transaction. The
// claim and the update both require the coordinates to be absent, so rerunning
// it never rewrites a placed venue and the loop settles on its own; a row
// outside the pool keeps its NULL until somebody places it deliberately.
// It returns how many rows the transaction actually placed.
func BackfillVenueCoordinates(ctx context.Context, tx pgx.Tx, limit int) (int64, error) {
	poolCities := make([]string, 0, len(cities))
	for _, home := range cities {
		poolCities = append(poolCities, home.Name)
	}

	rows, err := tx.Query(ctx,
		`SELECT event_id, city
		 FROM event_venues
		 WHERE latitude IS NULL AND longitude IS NULL
		   AND city = ANY($1)
		 ORDER BY event_id
		 LIMIT $2`,
		poolCities, limit)
	if err != nil {
		return 0, fmt.Errorf("claim coordinateless venues: %w", err)
	}
	defer rows.Close()

	var (
		eventIDs  []uuid.UUID
		latitude  []float64
		longitude []float64
	)
	for rows.Next() {
		var (
			eventID  uuid.UUID
			cityName string
		)
		if err := rows.Scan(&eventID, &cityName); err != nil {
			return 0, fmt.Errorf("scan coordinateless venue: %w", err)
		}
		home, ok := cityByName(cityName)
		if !ok {
			continue
		}
		lat, lon := venuePointFor(home, eventID)
		eventIDs = append(eventIDs, eventID)
		latitude = append(latitude, lat)
		longitude = append(longitude, lon)
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("read coordinateless venues: %w", err)
	}
	if len(eventIDs) == 0 {
		return 0, nil
	}

	args := make([]any, 0, len(eventIDs)*3)
	assignments := make([]string, len(eventIDs))
	for i, id := range eventIDs {
		assignments[i] = fmt.Sprintf("($%d::uuid,$%d::float8,$%d::float8)", i*3+1, i*3+2, i*3+3)
		args = append(args, id, latitude[i], longitude[i])
	}

	tag, err := tx.Exec(ctx,
		`UPDATE event_venues AS v
		 SET latitude = s.latitude, longitude = s.longitude
		 FROM (VALUES `+strings.Join(assignments, ",")+`) AS s(event_id, latitude, longitude)
		 WHERE v.event_id = s.event_id
		   AND v.latitude IS NULL AND v.longitude IS NULL`,
		args...)
	if err != nil {
		return 0, fmt.Errorf("place coordinateless venues: %w", err)
	}
	return tag.RowsAffected(), nil
}

// venuePointFor scatters one venue around its city centroid from the event's
// own identity, with the same jitter math the seed uses for new events: the
// point never depends on the run, and two events in one city sit near each
// other without sharing a spot.
func venuePointFor(home city, eventID uuid.UUID) (latitude, longitude float64) {
	sum := sha256.Sum256([]byte("eventa/seeder/venues/v1/" + eventID.String()))
	rng := rand.New(rand.NewPCG(
		binary.LittleEndian.Uint64(sum[0:8]),
		binary.LittleEndian.Uint64(sum[8:16]),
	))
	return jitterAround(home, rng)
}

func cityByName(name string) (city, bool) {
	for _, home := range cities {
		if home.Name == name {
			return home, true
		}
	}
	return city{}, false
}
