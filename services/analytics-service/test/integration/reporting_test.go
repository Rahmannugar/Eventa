package integration

import (
	"context"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	analyticsv1 "github.com/eventa/analytics-service/internal/gen/eventa/analytics/v1"
	"github.com/eventa/analytics-service/internal/logging"
	"github.com/eventa/analytics-service/internal/performance"
	"github.com/eventa/analytics-service/internal/reporting"
)

func eurPaidFact(t *testing.T, eventID, messageID string) []byte {
	t.Helper()
	return fact(t, map[string]any{
		"type":         "commerce.order-paid.v1",
		"messageId":    messageID,
		"orderId":      orderID,
		"attendeeId":   attendeeID,
		"eventId":      eventID,
		"ticketTypeId": ticketTypeID,
		"quantity":     2,
		"currency":     "EUR",
		"totalMinor":   8000,
		"paidAt":       "2026-10-20T10:00:00Z",
	})
}

func TestListAppliesStatusFilterAndReportsTotal(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetPerformance(t, pool)
	ingest := performance.NewIngest(pool)

	if _, err := ingest.Ingest(context.Background(), paidFact(t, paidEventID, firstMessage, 3, 15000)); err != nil {
		t.Fatalf("ingest paid: %v", err)
	}
	if _, err := ingest.Ingest(context.Background(), eurPaidFact(t, otherEventID, secondMessage)); err != nil {
		t.Fatalf("ingest eur paid: %v", err)
	}
	cancelled := fact(t, map[string]any{
		"type":        "event.cancelled.v1",
		"messageId":   refundMessage,
		"eventId":     otherEventID,
		"cancelledAt": "2026-10-19T18:00:00Z",
	})
	if _, err := ingest.Ingest(context.Background(), cancelled); err != nil {
		t.Fatalf("ingest cancelled: %v", err)
	}

	handler := reporting.NewHandler(reporting.NewRepository(pool), logging.New("test"))

	all, err := handler.ListEventPerformance(context.Background(), &analyticsv1.ListEventPerformanceRequest{})
	if err != nil {
		t.Fatalf("list all: %v", err)
	}
	if all.GetTotal() != 2 || len(all.GetEvents()) != 2 {
		t.Errorf("total/events = %d/%d, want 2/2", all.GetTotal(), len(all.GetEvents()))
	}

	cancelledOnly, err := handler.ListEventPerformance(context.Background(),
		&analyticsv1.ListEventPerformanceRequest{Status: "cancelled"})
	if err != nil {
		t.Fatalf("list cancelled: %v", err)
	}
	if cancelledOnly.GetTotal() != 1 || len(cancelledOnly.GetEvents()) != 1 {
		t.Errorf("cancelled total/events = %d/%d, want 1/1",
			cancelledOnly.GetTotal(), len(cancelledOnly.GetEvents()))
	}
	if cancelledOnly.GetEvents()[0].GetEventId() != otherEventID {
		t.Errorf("cancelled event = %q, want %q", cancelledOnly.GetEvents()[0].GetEventId(), otherEventID)
	}
}

func TestGetReportsNetRevenueDerivedFromItsParts(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetPerformance(t, pool)
	ingest := performance.NewIngest(pool)

	if _, err := ingest.Ingest(context.Background(), paidFact(t, paidEventID, firstMessage, 3, 15000)); err != nil {
		t.Fatalf("ingest paid: %v", err)
	}
	if _, err := ingest.Ingest(context.Background(), refundedFact(t, paidEventID, refundMessage, 1, 5000)); err != nil {
		t.Fatalf("ingest refunded: %v", err)
	}

	handler := reporting.NewHandler(reporting.NewRepository(pool), logging.New("test"))
	response, err := handler.GetEventPerformance(context.Background(),
		&analyticsv1.GetEventPerformanceRequest{EventId: paidEventID})
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	event := response.GetEvent()
	if event.GetGrossRevenueMinor() != 15000 || event.GetRefundedRevenueMinor() != 5000 {
		t.Errorf("gross/refunded = %d/%d", event.GetGrossRevenueMinor(), event.GetRefundedRevenueMinor())
	}
	if event.GetNetRevenueMinor() != 10000 {
		t.Errorf("net = %d, want 10000", event.GetNetRevenueMinor())
	}
}

func TestGetReportsNotFoundForUnknownEvent(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetPerformance(t, pool)
	handler := reporting.NewHandler(reporting.NewRepository(pool), logging.New("test"))

	_, err := handler.GetEventPerformance(context.Background(),
		&analyticsv1.GetEventPerformanceRequest{EventId: paidEventID})
	if status.Code(err) != codes.NotFound {
		t.Fatalf("code = %v, want NotFound", status.Code(err))
	}
}

func TestSummarySplitsRevenueByCurrency(t *testing.T) {
	pool := startMigratedDatabase(t)
	resetPerformance(t, pool)
	ingest := performance.NewIngest(pool)

	if _, err := ingest.Ingest(context.Background(), paidFact(t, paidEventID, firstMessage, 3, 15000)); err != nil {
		t.Fatalf("ingest usd paid: %v", err)
	}
	if _, err := ingest.Ingest(context.Background(), eurPaidFact(t, otherEventID, secondMessage)); err != nil {
		t.Fatalf("ingest eur paid: %v", err)
	}
	if _, err := ingest.Ingest(context.Background(), refundedFact(t, paidEventID, refundMessage, 1, 5000)); err != nil {
		t.Fatalf("ingest refunded: %v", err)
	}

	handler := reporting.NewHandler(reporting.NewRepository(pool), logging.New("test"))
	summary, err := handler.GetPortfolioSummary(context.Background(), &analyticsv1.GetPortfolioSummaryRequest{})
	if err != nil {
		t.Fatalf("summary: %v", err)
	}

	if summary.GetEventsPublished() != 2 {
		t.Errorf("published = %d, want 2", summary.GetEventsPublished())
	}
	revenue := summary.GetRevenue()
	if len(revenue) != 2 {
		t.Fatalf("currency rows = %d, want 2", len(revenue))
	}

	usd, eur := revenue[0], revenue[1]
	if usd.GetCurrency() != "USD" || eur.GetCurrency() != "EUR" {
		t.Fatalf("currencies = %q/%q, want USD/EUR", usd.GetCurrency(), eur.GetCurrency())
	}
	if usd.GetTicketsSold() != 3 || usd.GetGrossRevenueMinor() != 15000 ||
		usd.GetRefundedRevenueMinor() != 5000 || usd.GetNetRevenueMinor() != 10000 {
		t.Errorf("usd totals = %d/%d/%d/%d",
			usd.GetTicketsSold(), usd.GetGrossRevenueMinor(),
			usd.GetRefundedRevenueMinor(), usd.GetNetRevenueMinor())
	}
	if eur.GetTicketsSold() != 2 || eur.GetGrossRevenueMinor() != 8000 || eur.GetNetRevenueMinor() != 8000 {
		t.Errorf("eur totals = %d/%d/%d",
			eur.GetTicketsSold(), eur.GetGrossRevenueMinor(), eur.GetNetRevenueMinor())
	}
}
