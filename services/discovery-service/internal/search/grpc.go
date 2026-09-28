package search

import (
	"context"
	"log/slog"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	discoveryv1 "github.com/eventa/discovery-service/internal/gen/eventa/discovery/v1"
)

// Operation is the stable operation name this API reports under.
const Operation = "discovery.search"

// Handler serves Discovery's search RPC over its own projection.
type Handler struct {
	discoveryv1.UnimplementedDiscoveryServiceServer
	repository *Repository
	logger     *slog.Logger
}

// NewHandler binds the query to the projection and the service logger.
func NewHandler(repository *Repository, logger *slog.Logger) *Handler {
	return &Handler{repository: repository, logger: logger}
}

// SearchEvents answers one bounded query. A malformed request is reported as
// an invalid argument and a database failure as an internal error; neither is
// logged with the caller's query text.
func (h *Handler) SearchEvents(ctx context.Context, request *discoveryv1.SearchEventsRequest) (*discoveryv1.SearchEventsResponse, error) {
	filters, err := Parse(
		request.GetQuery(),
		request.GetCategories(),
		request.GetStartsFrom(),
		request.GetStartsTo(),
		request.GetLimit(),
		request.GetOffset(),
	)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid search filters")
	}

	rows, total, err := h.repository.Search(ctx, filters)
	if err != nil {
		return nil, status.Error(codes.Internal, "search unavailable")
	}

	results := make([]*discoveryv1.EventSearchResult, 0, len(rows))
	for i := range rows {
		results = append(results, toResult(&rows[i]))
	}

	h.logger.InfoContext(ctx, "search_completed",
		"operation", Operation,
		"outcome", "success",
		"results", len(results),
		"total", total,
		"has_query", filters.Query != "",
		"categories", len(filters.Categories),
		"has_time_bounds", filters.StartsFrom != nil || filters.StartsTo != nil,
	)

	return &discoveryv1.SearchEventsResponse{
		Events: results,
		Total:  int32(total),
		Limit:  int32(filters.Limit),
		Offset: int32(filters.Offset),
	}, nil
}

// toResult projects one stored row onto the response message.
func toResult(row *Row) *discoveryv1.EventSearchResult {
	return &discoveryv1.EventSearchResult{
		EventId:          row.EventID.String(),
		Title:            row.Title,
		Description:      row.Description,
		StartsAt:         formatTimestamp(row.StartsAt),
		EndsAt:           formatTimestamp(row.EndsAt),
		TimeZone:         row.TimeZone,
		Categories:       nonNil(row.Categories),
		VenueName:        row.VenueName,
		VenueCity:        row.VenueCity,
		VenueCountryCode: row.VenueCountryCode,
	}
}

func formatTimestamp(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339)
	return &formatted
}

func nonNil(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}
