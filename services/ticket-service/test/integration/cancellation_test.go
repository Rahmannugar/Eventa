package integration

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"sync"
	"testing"

	"github.com/eventa/ticket-service/internal/cancellation"
	"github.com/eventa/ticket-service/internal/checkin"
	"github.com/eventa/ticket-service/internal/issuance"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCancellationReplayWithSameMessageIDIsNoOp(t *testing.T) {
	ctx := context.Background()
	pool := startMigratedPostgres(t)
	svc := cancellation.NewService(pool)
	eventID := uuid.NewString()
	messageID := uuid.NewString()

	if err := issueOrder(ctx, t, pool, eventID, 2); err != nil {
		t.Fatalf("issue: %v", err)
	}
	input := cancellation.Cancellation{MessageID: messageID, EventID: eventID}
	if err := svc.CancelEvent(ctx, input); err != nil {
		t.Fatalf("first cancel: %v", err)
	}
	if err := svc.CancelEvent(ctx, input); err != nil {
		t.Fatalf("replay cancel: %v", err)
	}

	assertTicketCount(ctx, t, pool, eventID, 2)
	assertActiveTicketCount(ctx, t, pool, eventID, 0)
	assertRevocationOutboxCount(ctx, t, pool, eventID, 2)
	assertInboxCount(ctx, t, pool, "ticket_cancellation_inbox", 1)
}

func TestCancellationWithDistinctMessageIDDoesNotDuplicateRevocations(t *testing.T) {
	ctx := context.Background()
	pool := startMigratedPostgres(t)
	svc := cancellation.NewService(pool)
	eventID := uuid.NewString()

	if err := issueOrder(ctx, t, pool, eventID, 1); err != nil {
		t.Fatalf("issue: %v", err)
	}
	if err := svc.CancelEvent(ctx, cancellation.Cancellation{MessageID: uuid.NewString(), EventID: eventID}); err != nil {
		t.Fatalf("first cancel: %v", err)
	}
	if err := svc.CancelEvent(ctx, cancellation.Cancellation{MessageID: uuid.NewString(), EventID: eventID}); err != nil {
		t.Fatalf("second cancel: %v", err)
	}

	assertActiveTicketCount(ctx, t, pool, eventID, 0)
	assertRevocationOutboxCount(ctx, t, pool, eventID, 1)
	assertInboxCount(ctx, t, pool, "ticket_cancellation_inbox", 2)
}

func TestCancellationDominatesDelayedIssuance(t *testing.T) {
	ctx := context.Background()
	pool := startMigratedPostgres(t)
	cancel := cancellation.NewService(pool)
	issue := issuance.NewIssuanceService(pool)
	eventID := uuid.NewString()
	order := paidOrder(eventID, 3)

	if err := cancel.CancelEvent(ctx, cancellation.Cancellation{MessageID: uuid.NewString(), EventID: eventID}); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	if err := issue.IssuePaidOrder(ctx, order); err != nil {
		t.Fatalf("issue after cancel: %v", err)
	}

	assertTicketCount(ctx, t, pool, eventID, 0)
	var processed int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ticket_issuance_inbox WHERE event_id = $1 AND status = 'processed'`, string(order.MessageID)).Scan(&processed); err != nil {
		t.Fatalf("scan issuance inbox: %v", err)
	}
	if processed != 1 {
		t.Fatalf("expected processed issuance claim, got %d", processed)
	}
}

func TestCheckInAfterCancellationRejectsRevokedTicket(t *testing.T) {
	ctx := context.Background()
	pool := startMigratedPostgres(t)
	cancel := cancellation.NewService(pool)
	checkIn := checkin.NewService(pool)
	eventID := uuid.NewString()
	order := paidOrder(eventID, 1)
	issuer := issuance.NewIssuanceService(pool)

	if err := issuer.IssuePaidOrder(ctx, order); err != nil {
		t.Fatalf("issue: %v", err)
	}
	qr, err := ticketQRToken(ctx, pool, eventID)
	if err != nil {
		t.Fatalf("load qr: %v", err)
	}
	if err := cancel.CancelEvent(ctx, cancellation.Cancellation{MessageID: uuid.NewString(), EventID: eventID}); err != nil {
		t.Fatalf("cancel: %v", err)
	}
	_, err = checkIn.CheckIn(ctx, checkin.Request{
		QRToken:     base64.RawURLEncoding.EncodeToString(qr),
		EventID:     eventID,
		CheckedInBy: uuid.NewString(),
	})
	if !errors.Is(err, checkin.ErrTicketRevoked) {
		t.Fatalf("expected revoked rejection, got %v", err)
	}
	assertActiveTicketCount(ctx, t, pool, eventID, 0)
}

func TestConcurrentCancellationAndIssuanceLeavesNoActiveTickets(t *testing.T) {
	ctx := context.Background()
	pool := startMigratedPostgres(t)
	cancel := cancellation.NewService(pool)
	issue := issuance.NewIssuanceService(pool)
	eventID := uuid.NewString()
	order := paidOrder(eventID, 2)

	var wg sync.WaitGroup
	errs := make([]error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		errs[0] = cancel.CancelEvent(ctx, cancellation.Cancellation{MessageID: uuid.NewString(), EventID: eventID})
	}()
	go func() {
		defer wg.Done()
		errs[1] = issue.IssuePaidOrder(ctx, order)
	}()
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("goroutine %d: %v", i, err)
		}
	}

	assertActiveTicketCount(ctx, t, pool, eventID, 0)
	assertTicketCancelled(ctx, t, pool, eventID)
}

func TestConcurrentCancellationAndCheckInEndsWithRevokedTicket(t *testing.T) {
	ctx := context.Background()
	pool := startMigratedPostgres(t)
	cancel := cancellation.NewService(pool)
	checkIn := checkin.NewService(pool)
	issue := issuance.NewIssuanceService(pool)
	eventID := uuid.NewString()

	if err := issue.IssuePaidOrder(ctx, paidOrder(eventID, 1)); err != nil {
		t.Fatalf("issue: %v", err)
	}
	qr, err := ticketQRToken(ctx, pool, eventID)
	if err != nil {
		t.Fatalf("load qr: %v", err)
	}
	token := base64.RawURLEncoding.EncodeToString(qr)
	actor := uuid.NewString()

	var wg sync.WaitGroup
	errs := make([]error, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		errs[0] = cancel.CancelEvent(ctx, cancellation.Cancellation{MessageID: uuid.NewString(), EventID: eventID})
	}()
	go func() {
		defer wg.Done()
		_, err := checkIn.CheckIn(ctx, checkin.Request{QRToken: token, EventID: eventID, CheckedInBy: actor})
		if err != nil && !errors.Is(err, checkin.ErrTicketRevoked) {
			errs[1] = err
		}
	}()
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("goroutine %d: %v", i, err)
		}
	}

	var status string
	if err := pool.QueryRow(ctx, `SELECT status FROM issued_tickets WHERE event_id = $1`, eventID).Scan(&status); err != nil {
		t.Fatalf("scan status: %v", err)
	}
	if status != "revoked" {
		t.Fatalf("expected revoked, got %s", status)
	}
	assertTicketCancelled(ctx, t, pool, eventID)
	assertRevocationOutboxCount(ctx, t, pool, eventID, 1)
}

func TestIssuanceRollbackLeavesNoPartialState(t *testing.T) {
	ctx := context.Background()
	pool := startMigratedPostgres(t)
	eventID := uuid.NewString()
	order := paidOrder(eventID, 1)

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		t.Fatalf("rand: %v", err)
	}
	hash := sha256.Sum256(raw)
	_, err := pool.Exec(ctx, `
		INSERT INTO issued_tickets (id, order_id, attendee_id, event_id, ticket_type_id, unit_index, qr_token, qr_secret_hash)
		VALUES ($1, $2, $3, $4, $5, 0, $6, $7)`,
		uuid.New(), order.OrderID, order.AttendeeID, order.EventID, order.TicketTypeID, raw, hash[:])
	if err != nil {
		t.Fatalf("seed conflicting ticket: %v", err)
	}

	issuer := issuance.NewIssuanceService(pool)
	if err := issuer.IssuePaidOrder(ctx, order); err == nil {
		t.Fatal("expected unique constraint failure")
	}

	var tickets, inbox int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM issued_tickets WHERE event_id = $1`, eventID).Scan(&tickets); err != nil {
		t.Fatalf("count tickets: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ticket_issuance_inbox WHERE event_id = $1`, string(order.MessageID)).Scan(&inbox); err != nil {
		t.Fatalf("count inbox: %v", err)
	}
	if tickets != 1 || inbox != 0 {
		t.Fatalf("expected rollback to keep only the seed ticket, got tickets=%d inbox=%d", tickets, inbox)
	}
}

func TestRevocationOutboxPayloadCarriesTicketLifecycleType(t *testing.T) {
	ctx := context.Background()
	pool := startMigratedPostgres(t)
	svc := cancellation.NewService(pool)
	eventID := uuid.NewString()

	if err := issueOrder(ctx, t, pool, eventID, 1); err != nil {
		t.Fatalf("issue: %v", err)
	}
	if err := svc.CancelEvent(ctx, cancellation.Cancellation{MessageID: uuid.NewString(), EventID: eventID}); err != nil {
		t.Fatalf("cancel: %v", err)
	}

	var (
		aggregateType  string
		eventType      string
		payloadType    string
		payloadMessage string
		outboxEventID  pgtype.UUID
		aggregateID    pgtype.UUID
	)
	err := pool.QueryRow(ctx, `
		SELECT aggregate_type, event_type, payload->>'type', payload->>'messageId', event_id, aggregate_id
		FROM ticket_revocation_outbox
		WHERE aggregate_id IN (SELECT id FROM issued_tickets WHERE event_id = $1)`, eventID).
		Scan(&aggregateType, &eventType, &payloadType, &payloadMessage, &outboxEventID, &aggregateID)
	if err != nil {
		t.Fatalf("load outbox: %v", err)
	}
	if aggregateType != "eventa.ticket.revoked.v1" || eventType != "ticket.revoked.v1" || payloadType != "ticket.revoked.v1" {
		t.Fatalf("unexpected outbox identity %s %s %s", aggregateType, eventType, payloadType)
	}
	if payloadMessage != uuid.UUID(outboxEventID.Bytes).String() {
		t.Fatalf("payload messageId %s does not match outbox event_id %s", payloadMessage, uuid.UUID(outboxEventID.Bytes).String())
	}
	if uuid.UUID(aggregateID.Bytes) == uuid.UUID(outboxEventID.Bytes) {
		t.Fatal("expected distinct ticket aggregate key and message identity")
	}
}

func issueOrder(ctx context.Context, t *testing.T, pool *pgxpool.Pool, eventID string, quantity int) error {
	t.Helper()
	return issuance.NewIssuanceService(pool).IssuePaidOrder(ctx, paidOrder(eventID, quantity))
}

func paidOrder(eventID string, quantity int) issuance.PaidOrder {
	return issuance.PaidOrder{
		MessageID:    issuance.ID(uuid.NewString()),
		OrderID:      issuance.ID(uuid.NewString()),
		AttendeeID:   issuance.ID(uuid.NewString()),
		EventID:      issuance.ID(eventID),
		TicketTypeID: issuance.ID(uuid.NewString()),
		Quantity:     quantity,
	}
}

func ticketQRToken(ctx context.Context, pool *pgxpool.Pool, eventID string) ([]byte, error) {
	var token []byte
	err := pool.QueryRow(ctx, `SELECT qr_token FROM issued_tickets WHERE event_id = $1 LIMIT 1`, eventID).Scan(&token)
	return token, err
}

func assertTicketCount(ctx context.Context, t *testing.T, pool *pgxpool.Pool, eventID string, want int) {
	t.Helper()
	var got int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM issued_tickets WHERE event_id = $1`, eventID).Scan(&got); err != nil {
		t.Fatalf("count tickets: %v", err)
	}
	if got != want {
		t.Fatalf("expected %d tickets, got %d", want, got)
	}
}

func assertActiveTicketCount(ctx context.Context, t *testing.T, pool *pgxpool.Pool, eventID string, want int) {
	t.Helper()
	var got int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM issued_tickets WHERE event_id = $1 AND status <> 'revoked'`, eventID).Scan(&got); err != nil {
		t.Fatalf("count active tickets: %v", err)
	}
	if got != want {
		t.Fatalf("expected %d active tickets, got %d", want, got)
	}
}

func assertRevocationOutboxCount(ctx context.Context, t *testing.T, pool *pgxpool.Pool, eventID string, want int) {
	t.Helper()
	var got int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM ticket_revocation_outbox o
		JOIN issued_tickets t ON t.id = o.aggregate_id
		WHERE t.event_id = $1`, eventID).Scan(&got); err != nil {
		t.Fatalf("count outbox: %v", err)
	}
	if got != want {
		t.Fatalf("expected %d revocation outbox rows, got %d", want, got)
	}
}

func assertInboxCount(ctx context.Context, t *testing.T, pool *pgxpool.Pool, table string, want int) {
	t.Helper()
	var got int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM `+table).Scan(&got); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	if got != want {
		t.Fatalf("expected %d rows in %s, got %d", want, table, got)
	}
}

func assertTicketCancelled(ctx context.Context, t *testing.T, pool *pgxpool.Pool, eventID string) {
	t.Helper()
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ticket_cancelled_events WHERE event_id = $1)`, eventID).Scan(&exists); err != nil {
		t.Fatalf("scan cancelled: %v", err)
	}
	if !exists {
		t.Fatal("expected cancelled event marker")
	}
}
