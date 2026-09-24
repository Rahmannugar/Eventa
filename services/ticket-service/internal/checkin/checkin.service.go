package checkin

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/eventa/ticket-service/internal/queries"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrInvalidInput   = errors.New("invalid check-in request")
	ErrTicketNotFound = errors.New("ticket not found")
	ErrTicketRevoked  = errors.New("ticket revoked")
	ErrEventMismatch  = errors.New("ticket belongs to another event")
)

type Request struct {
	QRToken     string
	EventID     string
	CheckedInBy string
}

type Result struct {
	TicketID         string
	EventID          string
	CheckedInAt      time.Time
	AlreadyCheckedIn bool
}

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// CheckIn validates the QR secret and commits one durable state transition.
// Replaying a scan returns the existing transition without creating another event.
func (s *Service) CheckIn(ctx context.Context, input Request) (Result, error) {
	qr, eventID, actor, err := parseRequest(input)
	if err != nil {
		return Result{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Result{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := queries.New(tx)
	ticket, err := q.FindTicketForCheckIn(ctx, qr[:])
	if errors.Is(err, pgx.ErrNoRows) {
		return Result{}, ErrTicketNotFound
	}
	if err != nil {
		return Result{}, err
	}
	if string(ticket.EventID.Bytes[:]) != string(eventID[:]) {
		return Result{}, ErrEventMismatch
	}
	if ticket.Status == "revoked" {
		return Result{}, ErrTicketRevoked
	}
	if ticket.Status == "checked_in" {
		return Result{TicketID: uuid.UUID(ticket.ID.Bytes).String(), EventID: eventID.String(), CheckedInAt: ticket.CheckedInAt.Time, AlreadyCheckedIn: true}, nil
	}
	now := time.Now().UTC()
	if err := q.MarkTicketCheckedIn(ctx, queries.MarkTicketCheckedInParams{ID: ticket.ID, CheckedInAt: pgtype.Timestamptz{Time: now, Valid: true}, CheckedInBy: pgtype.UUID{Bytes: actor, Valid: true}}); err != nil {
		return Result{}, err
	}
	if err := q.CreateCheckInOutbox(ctx, queries.CreateCheckInOutboxParams{EventID: uuidToPG(uuid.New()), TicketID: ticket.ID, OccurredAt: pgtype.Timestamptz{Time: now, Valid: true}}); err != nil {
		return Result{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Result{}, err
	}
	return Result{TicketID: uuid.UUID(ticket.ID.Bytes).String(), EventID: eventID.String(), CheckedInAt: now}, nil
}

func uuidToPG(value uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: value, Valid: true} }

func parseRequest(input Request) ([32]byte, uuid.UUID, uuid.UUID, error) {
	raw, err := base64.RawURLEncoding.DecodeString(input.QRToken)
	if err != nil || len(raw) == 0 {
		return [32]byte{}, uuid.Nil, uuid.Nil, fmt.Errorf("%w: qr token", ErrInvalidInput)
	}
	eventID, err := uuid.Parse(input.EventID)
	if err != nil {
		return [32]byte{}, uuid.Nil, uuid.Nil, fmt.Errorf("%w: event id", ErrInvalidInput)
	}
	actor, err := uuid.Parse(input.CheckedInBy)
	if err != nil {
		return [32]byte{}, uuid.Nil, uuid.Nil, fmt.Errorf("%w: actor id", ErrInvalidInput)
	}
	return sha256.Sum256(raw), eventID, actor, nil
}
