package interests

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Row is one attendee's stored interests as Discovery holds them.
type Row struct {
	AttendeeID uuid.UUID
	Interests  []string
	UpdatedAt  time.Time
}

// Repository reads and writes the Discovery-owned preference record. It never
// touches another service's database: the attendee id arrives from the
// Gateway's session, and Identity owns the account itself.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository binds the pool the service already owns.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

// Get returns the stored interests, or nil when the attendee has never saved
// any. No record means no interests, which is a real answer rather than a
// failure.
func (r *Repository) Get(ctx context.Context, attendeeID uuid.UUID) (*Row, error) {
	row := &Row{}
	err := r.pool.QueryRow(ctx,
		`SELECT attendee_id, interests, updated_at
		   FROM discovery_attendee_interests WHERE attendee_id = $1`,
		attendeeID,
	).Scan(&row.AttendeeID, &row.Interests, &row.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read attendee interests: %w", err)
	}
	return row, nil
}

// Upsert stores the whole interest list for one attendee in one statement, so
// a repeated submission replaces the previous one instead of appending to it.
func (r *Repository) Upsert(ctx context.Context, attendeeID uuid.UUID, interests []string) (*Row, error) {
	row := &Row{}
	err := r.pool.QueryRow(ctx,
		`INSERT INTO discovery_attendee_interests (attendee_id, interests)
		 VALUES ($1, $2)
		 ON CONFLICT (attendee_id) DO UPDATE
		   SET interests = EXCLUDED.interests,
		       updated_at = now()
		 RETURNING attendee_id, interests, updated_at`,
		attendeeID, interests,
	).Scan(&row.AttendeeID, &row.Interests, &row.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("store attendee interests: %w", err)
	}
	return row, nil
}
