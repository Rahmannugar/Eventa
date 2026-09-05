package tickets

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/eventa/ticket-service/internal/queries"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ID string

var ErrInvalidInput = errors.New("invalid ticket request")

type IssuedTicket struct {
	ID, OrderID, AttendeeID, EventID, TicketTypeID ID
	UnitIndex                                      int32
	Status                                         string
	IssuedAt                                       time.Time
	QRToken                                        string
}
type TicketReader struct{ pool *pgxpool.Pool }

func NewTicketReader(pool *pgxpool.Pool) *TicketReader { return &TicketReader{pool: pool} }

// ListAttendeeTickets returns only tickets owned by the requesting attendee.
type Cursor struct {
	IssuedAt time.Time
	ID       ID
}

func EncodeCursor(cursor Cursor) (string, error) {
	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func DecodeCursor(value string) (Cursor, error) {
	payload, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return Cursor{}, fmt.Errorf("%w: invalid cursor", ErrInvalidInput)
	}
	var cursor Cursor
	if err := json.Unmarshal(payload, &cursor); err != nil || cursor.ID == "" || cursor.IssuedAt.IsZero() {
		return Cursor{}, fmt.Errorf("%w: invalid cursor", ErrInvalidInput)
	}
	if _, err := uuid.Parse(string(cursor.ID)); err != nil {
		return Cursor{}, fmt.Errorf("%w: invalid cursor", ErrInvalidInput)
	}
	return cursor, nil
}

func (r *TicketReader) ListAttendeeTickets(ctx context.Context, attendeeID ID, before *Cursor, limit int32) ([]IssuedTicket, error) {
	if limit < 1 || limit > 100 {
		return nil, fmt.Errorf("%w: invalid ticket page size", ErrInvalidInput)
	}
	attendee, err := uuid.Parse(string(attendeeID))
	if err != nil {
		return nil, fmt.Errorf("%w: invalid attendee identifier", ErrInvalidInput)
	}
	var cursor pgtype.Timestamptz
	var cursorID pgtype.UUID
	if before != nil {
		cursor = pgtype.Timestamptz{Time: before.IssuedAt, Valid: true}
		parsedID, _ := uuid.Parse(string(before.ID))
		cursorID = pgtype.UUID{Bytes: parsedID, Valid: true}
	}
	rows, err := queries.New(r.pool).ListIssuedTicketsByAttendee(ctx, queries.ListIssuedTicketsByAttendeeParams{AttendeeID: pgtype.UUID{Bytes: attendee, Valid: true}, Column2: cursor, Column3: cursorID, Limit: limit})
	if err != nil {
		return nil, err
	}
	result := make([]IssuedTicket, 0, len(rows))
	for _, row := range rows {
		result = append(result, IssuedTicket{ID: toID(row.ID), OrderID: toID(row.OrderID), AttendeeID: toID(row.AttendeeID), EventID: toID(row.EventID), TicketTypeID: toID(row.TicketTypeID), UnitIndex: row.UnitIndex, Status: row.Status, IssuedAt: row.IssuedAt.Time, QRToken: base64.RawURLEncoding.EncodeToString(row.QrToken)})
	}
	return result, nil
}

func toID(value pgtype.UUID) ID { return ID(uuid.UUID(value.Bytes).String()) }
