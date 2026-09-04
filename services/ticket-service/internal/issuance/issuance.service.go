package issuance

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"

	"github.com/eventa/ticket-service/internal/queries"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ID string

type PaidOrder struct {
	EventID, OrderID, AttendeeID, TicketTypeID ID
	Quantity                                   int
	MessageID                                  ID
}
type IssuanceService struct{ pool *pgxpool.Pool }

func NewIssuanceService(pool *pgxpool.Pool) *IssuanceService { return &IssuanceService{pool: pool} }

// IssuePaidOrder creates one ticket per purchased unit and ignores replayed events.
func (s *IssuanceService) IssuePaidOrder(ctx context.Context, order PaidOrder) error {
	if err := validateQuantity(order.Quantity); err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	ids, err := parseIDs(order)
	if err != nil {
		return err
	}
	q := queries.New(tx)
	_, err = q.ClaimIssuanceEvent(ctx, ids.message)
	if errors.Is(err, pgx.ErrNoRows) {
		return tx.Commit(ctx)
	}
	if err != nil {
		return err
	}
	for i := 0; i < order.Quantity; i++ {
		raw := make([]byte, 32)
		if _, err := rand.Read(raw); err != nil {
			return err
		}
		hash := sha256.Sum256(raw)
		if err := q.CreateIssuedTicket(ctx, queries.CreateIssuedTicketParams{ID: uuidToPG(uuid.New()), OrderID: ids.order, AttendeeID: ids.attendee, EventID: ids.event, TicketTypeID: ids.ticket, UnitIndex: int32(i), QrSecretHash: hash[:]}); err != nil {
			return err
		}
	}
	err = q.MarkIssuanceProcessed(ctx, ids.message)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

type parsedIDs struct{ message, order, attendee, event, ticket pgtype.UUID }

func parseIDs(o PaidOrder) (parsedIDs, error) {
	values := []ID{o.MessageID, o.OrderID, o.AttendeeID, o.EventID, o.TicketTypeID}
	parsed := make([]pgtype.UUID, len(values))
	for i, value := range values {
		id, err := uuid.Parse(string(value))
		if err != nil {
			return parsedIDs{}, fmt.Errorf("invalid identifier: %w", err)
		}
		parsed[i] = uuidToPG(id)
	}
	return parsedIDs{parsed[0], parsed[1], parsed[2], parsed[3], parsed[4]}, nil
}
func uuidToPG(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func validateQuantity(quantity int) error {
	if quantity < 1 || quantity > 1000000 {
		return errInvalidQuantity
	}
	return nil
}

var errInvalidQuantity = fmt.Errorf("invalid quantity")
