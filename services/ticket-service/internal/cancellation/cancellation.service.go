package cancellation

import (
	"context"
	"errors"
	"fmt"

	"github.com/eventa/ticket-service/internal/queries"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Cancellation struct {
	MessageID string
	EventID   string
}

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// CancelEvent claims the cancellation fact and revokes all tickets atomically.
// The inbox key makes broker replay a no-op after the first committed transition.
func (s *Service) CancelEvent(ctx context.Context, input Cancellation) error {
	messageID, err := uuid.Parse(input.MessageID)
	if err != nil {
		return fmt.Errorf("invalid cancellation message id: %w", err)
	}
	eventID, err := uuid.Parse(input.EventID)
	if err != nil {
		return fmt.Errorf("invalid cancellation event id: %w", err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := queries.New(tx)
	if err := q.LockEvent(ctx, eventID.String()); err != nil {
		return err
	}
	claimed, err := q.ClaimCancellationEvent(ctx, queries.ClaimCancellationEventParams{
		MessageID: pgtype.UUID{Bytes: messageID, Valid: true},
		EventID:   pgtype.UUID{Bytes: eventID, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return tx.Commit(ctx)
	}
	if err != nil {
		return err
	}
	if err := q.MarkEventCancelled(ctx, queries.MarkEventCancelledParams{
		EventID:               pgtype.UUID{Bytes: eventID, Valid: true},
		CancellationMessageID: claimed,
	}); err != nil {
		return err
	}
	tickets, err := q.ListTicketsForRevocation(ctx, pgtype.UUID{Bytes: eventID, Valid: true})
	if err != nil {
		return err
	}
	for _, ticketID := range tickets {
		if err := q.RevokeTicket(ctx, queries.RevokeTicketParams{ID: ticketID, EventID: pgtype.UUID{Bytes: eventID, Valid: true}}); err != nil {
			return err
		}
		if err := q.CreateRevocationOutbox(ctx, queries.CreateRevocationOutboxParams{MessageID: pgtype.UUID{Bytes: uuid.New(), Valid: true}, TicketID: ticketID}); err != nil {
			return err
		}
	}
	if err := q.MarkCancellationProcessed(ctx, claimed); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
