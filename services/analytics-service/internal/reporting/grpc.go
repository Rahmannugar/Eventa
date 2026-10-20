package reporting

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	analyticsv1 "github.com/eventa/analytics-service/internal/gen/eventa/analytics/v1"
)

// Operation is the stable operation name this API reports under.
const Operation = "analytics.reporting"

// List defaults and bounds match the Gateway's admin reporting surface: one
// page answers a dashboard view without a second round trip.
const (
	defaultListLimit = 25
	maxListLimit     = 100
)

// Handler serves Analytics's reporting RPCs over its own projection.
type Handler struct {
	analyticsv1.UnimplementedAnalyticsServiceServer
	repository *Repository
	logger     *slog.Logger
}

// NewHandler binds the queries to the projection and the service logger.
func NewHandler(repository *Repository, logger *slog.Logger) *Handler {
	return &Handler{repository: repository, logger: logger}
}

// ListEventPerformance answers one bounded page of per-event rows. A caller
// filters by status and pages with limit/offset; the response carries the
// exact total for the same filter.
func (h *Handler) ListEventPerformance(ctx context.Context, request *analyticsv1.ListEventPerformanceRequest) (*analyticsv1.ListEventPerformanceResponse, error) {
	limit, err := normaliseLimit(request.GetLimit())
	if err != nil {
		return nil, err
	}
	offset := int(request.GetOffset())
	if offset < 0 {
		return nil, status.Error(codes.InvalidArgument, "invalid offset")
	}
	filters := request.GetStatus()
	if filters != "" && filters != "published" && filters != "cancelled" {
		return nil, status.Error(codes.InvalidArgument, "invalid status filter")
	}

	rows, total, queryErr := h.repository.List(ctx, limit, offset, filters)
	if queryErr != nil {
		h.logger.ErrorContext(ctx, "event_performance_list_failed",
			"operation", Operation, "outcome", "server_error")
		return nil, status.Error(codes.Internal, "event performance unavailable")
	}

	events := make([]*analyticsv1.EventPerformance, 0, len(rows))
	for i := range rows {
		events = append(events, toPerformance(&rows[i]))
	}

	h.logger.InfoContext(ctx, "event_performance_listed",
		"operation", Operation, "outcome", "success",
		"results", len(events), "total", total, "has_filter", filters != "")

	return &analyticsv1.ListEventPerformanceResponse{
		Events: events,
		Total:  int32(total),
		Limit:  int32(limit),
		Offset: int32(offset),
	}, nil
}

// GetEventPerformance answers one event's row. An unknown event is a not
// found, not an error of the service.
func (h *Handler) GetEventPerformance(ctx context.Context, request *analyticsv1.GetEventPerformanceRequest) (*analyticsv1.GetEventPerformanceResponse, error) {
	eventID, err := uuid.Parse(request.GetEventId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid event id")
	}

	row, err := h.repository.Get(ctx, eventID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, status.Error(codes.NotFound, "event performance not found")
	}
	if err != nil {
		h.logger.ErrorContext(ctx, "event_performance_get_failed",
			"operation", Operation, "outcome", "server_error")
		return nil, status.Error(codes.Internal, "event performance unavailable")
	}

	return &analyticsv1.GetEventPerformanceResponse{
		Event: toPerformance(row),
	}, nil
}

// GetPortfolioSummary answers the roll-up across every projected event. The
// revenue split stays per currency: totals are never summed across different
// currencies into one invented number.
func (h *Handler) GetPortfolioSummary(ctx context.Context, _ *analyticsv1.GetPortfolioSummaryRequest) (*analyticsv1.GetPortfolioSummaryResponse, error) {
	summary, err := h.repository.Summary(ctx)
	if err != nil {
		h.logger.ErrorContext(ctx, "portfolio_summary_failed",
			"operation", Operation, "outcome", "server_error")
		return nil, status.Error(codes.Internal, "portfolio summary unavailable")
	}

	revenue := make([]*analyticsv1.CurrencyTotals, 0, len(summary.Revenue))
	for i := range summary.Revenue {
		row := &summary.Revenue[i]
		revenue = append(revenue, &analyticsv1.CurrencyTotals{
			Currency:             row.Currency,
			TicketsSold:          row.TicketsSold,
			TicketsRefunded:      row.TicketsRefunded,
			GrossRevenueMinor:    row.GrossRevenueMinor,
			RefundedRevenueMinor: row.RefundedRevenueMinor,
			NetRevenueMinor:      row.GrossRevenueMinor - row.RefundedRevenueMinor,
		})
	}

	return &analyticsv1.GetPortfolioSummaryResponse{
		EventsPublished:  summary.EventsPublished,
		EventsCancelled:  summary.EventsCancelled,
		TicketsCheckedIn: summary.TicketsCheckedIn,
		TicketsRevoked:   summary.TicketsRevoked,
		Revenue:          revenue,
	}, nil
}

func normaliseLimit(requested int32) (int, error) {
	if requested == 0 {
		return defaultListLimit, nil
	}
	if requested < 1 || requested > maxListLimit {
		return 0, status.Error(codes.InvalidArgument, "invalid limit")
	}
	return int(requested), nil
}

// toPerformance projects one stored row onto the response message. Net
// revenue is derived, not stored, so it can never drift from its parts.
func toPerformance(row *Row) *analyticsv1.EventPerformance {
	return &analyticsv1.EventPerformance{
		EventId:              row.EventID.String(),
		Status:               row.Status,
		Currency:             nonNil(row.Currency),
		TicketsSold:          row.TicketsSold,
		TicketsRefunded:      row.TicketsRefunded,
		TicketsCheckedIn:     row.TicketsCheckedIn,
		TicketsRevoked:       row.TicketsRevoked,
		GrossRevenueMinor:    row.GrossRevenueMinor,
		RefundedRevenueMinor: row.RefundedRevenueMinor,
		NetRevenueMinor:      row.GrossRevenueMinor - row.RefundedRevenueMinor,
		PublishedAt:          formatOptionalTime(row.PublishedAt),
		CancelledAt:          formatOptionalTime(row.CancelledAt),
		UpdatedAt:            row.UpdatedAt.Format(time.RFC3339),
	}
}

func nonNil(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func formatOptionalTime(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.Format(time.RFC3339)
	return &formatted
}
