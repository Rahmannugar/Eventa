package integration

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/eventa/analytics-service/internal/facts"
	"github.com/eventa/analytics-service/internal/performance"
)

const (
	paidEventID   = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	otherEventID  = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	firstMessage  = "11111111-1111-4111-8111-111111111111"
	secondMessage = "22222222-2222-4222-8222-222222222222"
	refundMessage = "33333333-3333-4333-8333-333333333333"
	orderID       = "44444444-4444-4444-8444-444444444444"
	ticketTypeID  = "55555555-5555-4555-8555-555555555555"
	attendeeID    = "66666666-6666-4666-8666-666666666666"
)

func fact(t *testing.T, body map[string]any) []byte {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal fact: %v", err)
	}
	return encoded
}

func paidFact(t *testing.T, eventID, messageID string, quantity int, totalMinor int64) []byte {
	t.Helper()
	return fact(t, map[string]any{
		"type":         facts.OrderPaidType,
		"messageId":    messageID,
		"orderId":      orderID,
		"attendeeId":   attendeeID,
		"eventId":      eventID,
		"ticketTypeId": ticketTypeID,
		"quantity":     quantity,
		"currency":     "USD",
		"totalMinor":   totalMinor,
		"paidAt":       "2026-10-20T10:00:00Z",
	})
}

func refundedFact(t *testing.T, eventID, messageID string, quantity int, totalMinor int64) []byte {
	t.Helper()
	return fact(t, map[string]any{
		"type":         facts.OrderRefundedType,
		"messageId":    messageID,
		"orderId":      orderID,
		"attendeeId":   attendeeID,
		"eventId":      eventID,
		"ticketTypeId": ticketTypeID,
		"quantity":     quantity,
		"currency":     "USD",
		"totalMinor":   totalMinor,
		"refundedAt":   "2026-10-20T15:00:00Z",
	})
}

func checkedInFact(t *testing.T, eventID, messageID string) []byte {
	t.Helper()
	return fact(t, map[string]any{
		"type":        facts.CheckedInType,
		"messageId":   messageID,
		"eventId":     eventID,
		"ticketId":    "77777777-7777-4777-8777-777777777777",
		"attendeeId":  attendeeID,
		"checkedInAt": "2026-10-20T18:00:00Z",
	})
}

func TestPaidFactAddsTicketsAndGrossRevenue(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetPerformance(t, pool)
	ingest := performance.NewIngest(pool)

	outcome, err := ingest.Ingest(context.Background(), paidFact(t, paidEventID, firstMessage, 3, 15000))
	if err != nil {
		t.Fatalf("ingest paid fact: %v", err)
	}
	if outcome != performance.OutcomeProcessed {
		t.Fatalf("outcome = %q, want processed", outcome)
	}

	var sold, gross int64
	err = pool.QueryRow(context.Background(),
		`SELECT tickets_sold, gross_revenue_minor FROM analytics_event_performance WHERE event_id = $1`,
		paidEventID).Scan(&sold, &gross)
	if err != nil {
		t.Fatalf("read projection: %v", err)
	}
	if sold != 3 || gross != 15000 {
		t.Errorf("sold/gross = %d/%d, want 3/15000", sold, gross)
	}
}

func TestReplayedPaidFactDoesNotDoubleCount(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetPerformance(t, pool)
	ingest := performance.NewIngest(pool)

	first, err := ingest.Ingest(context.Background(), paidFact(t, paidEventID, firstMessage, 3, 15000))
	if err != nil || first != performance.OutcomeProcessed {
		t.Fatalf("first ingest = %q, %v", first, err)
	}
	second, err := ingest.Ingest(context.Background(), paidFact(t, paidEventID, firstMessage, 3, 15000))
	if err != nil {
		t.Fatalf("replayed ingest: %v", err)
	}
	if second != performance.OutcomeDuplicate {
		t.Fatalf("replay outcome = %q, want duplicate", second)
	}

	var sold, gross int64
	err = pool.QueryRow(context.Background(),
		`SELECT tickets_sold, gross_revenue_minor FROM analytics_event_performance WHERE event_id = $1`,
		paidEventID).Scan(&sold, &gross)
	if err != nil {
		t.Fatalf("read projection: %v", err)
	}
	if sold != 3 || gross != 15000 {
		t.Errorf("sold/gross after replay = %d/%d, want unchanged 3/15000", sold, gross)
	}
}

func TestRefundLowersNetRevenue(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetPerformance(t, pool)
	ingest := performance.NewIngest(pool)

	if _, err := ingest.Ingest(context.Background(), paidFact(t, paidEventID, firstMessage, 3, 15000)); err != nil {
		t.Fatalf("ingest paid fact: %v", err)
	}
	if _, err := ingest.Ingest(context.Background(), refundedFact(t, paidEventID, refundMessage, 1, 5000)); err != nil {
		t.Fatalf("ingest refunded fact: %v", err)
	}

	var sold, refunded, gross, returned int64
	err := pool.QueryRow(context.Background(),
		`SELECT tickets_sold, tickets_refunded, gross_revenue_minor, refunded_revenue_minor
		 FROM analytics_event_performance WHERE event_id = $1`,
		paidEventID).Scan(&sold, &refunded, &gross, &returned)
	if err != nil {
		t.Fatalf("read projection: %v", err)
	}
	if sold != 3 || refunded != 1 || gross != 15000 || returned != 5000 {
		t.Errorf("sold/refunded/gross/returned = %d/%d/%d/%d", sold, refunded, gross, returned)
	}
}

func TestCheckedInFactCountsTickets(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetPerformance(t, pool)
	ingest := performance.NewIngest(pool)

	if _, err := ingest.Ingest(context.Background(), paidFact(t, paidEventID, firstMessage, 2, 10000)); err != nil {
		t.Fatalf("ingest paid fact: %v", err)
	}
	outcome, err := ingest.Ingest(context.Background(), checkedInFact(t, paidEventID, secondMessage))
	if err != nil || outcome != performance.OutcomeProcessed {
		t.Fatalf("ingest checked-in fact = %q, %v", outcome, err)
	}

	var checkedIn int64
	if err := pool.QueryRow(context.Background(),
		`SELECT tickets_checked_in FROM analytics_event_performance WHERE event_id = $1`,
		paidEventID).Scan(&checkedIn); err != nil {
		t.Fatalf("read projection: %v", err)
	}
	if checkedIn != 1 {
		t.Errorf("checked in = %d, want 1", checkedIn)
	}
}

func TestCancelledFactMarksTheEventCancelled(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetPerformance(t, pool)
	ingest := performance.NewIngest(pool)

	cancelled := fact(t, map[string]any{
		"type":        facts.CancelledType,
		"messageId":   secondMessage,
		"eventId":     otherEventID,
		"cancelledAt": "2026-10-19T18:00:00Z",
	})
	outcome, err := ingest.Ingest(context.Background(), cancelled)
	if err != nil || outcome != performance.OutcomeProcessed {
		t.Fatalf("ingest cancelled fact = %q, %v", outcome, err)
	}

	var status string
	var cancelledAt any
	if err := pool.QueryRow(context.Background(),
		`SELECT status, cancelled_at FROM analytics_event_performance WHERE event_id = $1`,
		otherEventID).Scan(&status, &cancelledAt); err != nil {
		t.Fatalf("read projection: %v", err)
	}
	if status != "cancelled" || cancelledAt == nil {
		t.Errorf("status/cancelled_at = %q/%v, want cancelled with a timestamp", status, cancelledAt)
	}
}

func TestRejectedFactWritesNothing(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetPerformance(t, pool)
	ingest := performance.NewIngest(pool)

	broken := fact(t, map[string]any{
		"type":      facts.OrderPaidType,
		"messageId": firstMessage,
		"eventId":   "not-a-uuid",
	})
	_, err := ingest.Ingest(context.Background(), broken)
	if !errors.Is(err, performance.ErrFactRejected) {
		t.Fatalf("error = %v, want ErrFactRejected", err)
	}

	var count int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM analytics_event_performance`).Scan(&count); err != nil {
		t.Fatalf("count projection: %v", err)
	}
	if count != 0 {
		t.Errorf("projection rows = %d, want 0", count)
	}
}

func TestForeignFactsAreAcknowledgedWithoutProjection(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetPerformance(t, pool)
	ingest := performance.NewIngest(pool)

	outcome, err := ingest.Ingest(context.Background(), fact(t, map[string]any{"type": "email.sent.v1"}))
	if err != nil || outcome != performance.OutcomeIgnored {
		t.Fatalf("outcome = %q, %v, want ignored", outcome, err)
	}

	var count int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM analytics_event_performance`).Scan(&count); err != nil {
		t.Fatalf("count projection: %v", err)
	}
	if count != 0 {
		t.Errorf("projection rows = %d, want 0", count)
	}
}
