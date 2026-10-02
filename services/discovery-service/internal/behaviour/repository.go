package behaviour

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Repository persists the inbox claim, the evidence row, and the bounded read
// the preference rendering consumes. It never touches another service's
// database: the ids arrive inside facts Kafka already delivered.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository binds the pool the service already owns.
func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

func (r *Repository) begin(ctx context.Context) (pgx.Tx, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	return tx, nil
}

// claim records the fact in the durable inbox. A false result means the fact
// was already applied, so the caller must do no further work. Both facts
// carry their own message id, so the inbox primary key
// `(event_type, message_id)` is the whole dedupe identity.
func claim(ctx context.Context, tx pgx.Tx, fact Fact) (bool, error) {
	var applied string
	err := tx.QueryRow(ctx, `
		INSERT INTO discovery_behaviour_inbox (event_type, message_id, attendee_id, event_id)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (event_type, message_id) DO NOTHING
		RETURNING event_type
	`, fact.Type, fact.MessageID, fact.AttendeeID, fact.EventID).Scan(&applied)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("claim behaviour fact: %w", err)
	}
	return true, nil
}

// recordEvidence upserts one attendee's evidence for one event under one kind.
// Evidence is per attendee, event, and kind: a second ticket or a repeat
// purchase does not add weight, it only moves the occurrence forward, and the
// newest fact wins only when it really is newer than the one already stored.
func recordEvidence(ctx context.Context, tx pgx.Tx, fact Fact) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO discovery_attendee_behaviour (attendee_id, event_id, kind, occurred_at)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (attendee_id, event_id, kind) DO UPDATE
		   SET occurred_at = GREATEST(discovery_attendee_behaviour.occurred_at, EXCLUDED.occurred_at),
		       updated_at = now()
	`, fact.AttendeeID, fact.EventID, string(fact.Kind), fact.OccurredAt)
	if err != nil {
		return fmt.Errorf("record behaviour evidence: %w", err)
	}
	return nil
}

// Evidence is one behavioural row joined to the projection content the
// preference rendering needs. Evidence for an event Discovery holds no content
// for stays in the table but never reaches the renderer: the predicate keeps
// only rows with a title.
type Evidence struct {
	EventID    string
	Kind       Kind
	OccurredAt time.Time
	Title      string
	Categories []string
	VenueCity  *string
}

// Evidence returns one attendee's most recent rows of one kind, strongest
// recency first, bounded by the caller. It reads Discovery's own tables only.
func (r *Repository) Evidence(ctx context.Context, attendeeID uuid.UUID, kind Kind, limit int) ([]Evidence, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT b.event_id, b.kind, b.occurred_at, i.title, i.categories, i.venue_city
		  FROM discovery_attendee_behaviour b
		  JOIN discovery_event_index i ON i.event_id = b.event_id
		 WHERE b.attendee_id = $1
		   AND b.kind = $2
		   AND i.title IS NOT NULL
		   AND i.title <> ''
		 ORDER BY b.occurred_at DESC
		 LIMIT $3
	`, attendeeID, string(kind), limit)
	if err != nil {
		return nil, fmt.Errorf("read behaviour evidence: %w", err)
	}
	defer rows.Close()

	var evidence []Evidence
	for rows.Next() {
		row := Evidence{}
		var storedKind string
		if err := rows.Scan(&row.EventID, &storedKind, &row.OccurredAt,
			&row.Title, &row.Categories, &row.VenueCity); err != nil {
			return nil, fmt.Errorf("scan behaviour evidence: %w", err)
		}
		row.Kind = Kind(storedKind)
		evidence = append(evidence, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read behaviour evidence: %w", err)
	}
	return evidence, nil
}
