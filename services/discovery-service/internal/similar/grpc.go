// Package similar answers one question about one event: which other events
// are like it. Discovery reads the source event from its own projection,
// embeds the same text the indexer embeds, asks the store for the nearest
// entries, and lets Event Service decide which of them it still serves.
package similar

import (
	"context"
	"log/slog"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	discoveryv1 "github.com/eventa/discovery-service/internal/gen/eventa/discovery/v1"
	"github.com/eventa/discovery-service/internal/ranking"
	"github.com/eventa/discovery-service/internal/semantic"
)

// Operation is the stable operation name this API reports under.
const Operation = "discovery.similar"

// Source is the Discovery-owned projection the source event is read from. It
// is satisfied by the semantic repository, which already reads the projection
// beside the index state.
type Source interface {
	GetWork(ctx context.Context, eventID string) (*semantic.Work, error)
}

// Handler serves Discovery's similarity RPC over the projection Discovery
// owns, the semantic store, and the Event Service boundary.
type Handler struct {
	discoveryv1.UnimplementedDiscoveryServiceServer
	source Source
	store  semantic.Store
	events ranking.Resolver
	logger *slog.Logger
}

// NewHandler binds the projection, the store, and the Event Service boundary
// to the service logger.
func NewHandler(source Source, store semantic.Store, events ranking.Resolver, logger *slog.Logger) *Handler {
	return &Handler{source: source, store: store, events: events, logger: logger}
}

// SimilarEvents answers with the events nearest to the one asked about. The
// source event is embedded from Discovery's own copy of its text, so the
// query is identical to what the indexer stored and lands in the same vector
// space. An event Discovery does not hold as published is reported as not
// found, and the source event is never returned with itself.
func (h *Handler) SimilarEvents(ctx context.Context, request *discoveryv1.SimilarEventsRequest) (*discoveryv1.SimilarEventsResponse, error) {
	eventID, err := parseEventID(request.GetEventId())
	if err != nil {
		return nil, err
	}
	limit, err := ranking.ParseLimit(request.GetLimit())
	if err != nil {
		return nil, err
	}

	response := &discoveryv1.SimilarEventsResponse{
		EventId: eventID,
		Events:  []*discoveryv1.EventSearchResult{},
	}

	source, err := h.source.GetWork(ctx, eventID)
	if err != nil {
		return nil, status.Error(codes.Internal, "similar events unavailable")
	}
	if source == nil || source.Desired != "index" || !source.HasText {
		h.logger.InfoContext(ctx, "similar_event_not_found",
			"operation", Operation,
			"outcome", "not_found",
		)
		return nil, status.Error(codes.NotFound, "event not found")
	}

	query := semantic.Truncate(semantic.BuildText(
		source.Title, source.Desc, source.Categories, source.VenueName, source.VenueCity,
	))
	candidates, err := h.store.Search(ctx, query, ranking.CandidateLimit(limit))
	if err != nil {
		h.logger.WarnContext(ctx, "similar_store_failed",
			"operation", Operation,
			"outcome", "failed",
			"error_type", semantic.ErrorClass(err),
		)
		return nil, status.Error(codes.Unavailable, "similar events unavailable")
	}

	ids := neighbours(ranking.UniqueIDs(candidates), eventID)
	if len(ids) == 0 {
		h.logCompleted(ctx, "no_candidates", 0, 0)
		return response, nil
	}

	resolved, err := h.events.ListRecommendableEvents(ctx, ids)
	if err != nil {
		h.logger.WarnContext(ctx, "similar_resolve_failed",
			"operation", Operation,
			"outcome", "failed",
			"error_type", semantic.ErrorClass(err),
		)
		return nil, ranking.ResolveError(err, "similar events unavailable")
	}

	for _, candidateID := range ids {
		content := resolved[candidateID]
		if content == nil {
			continue
		}
		response.Events = append(response.Events, ranking.ToResult(candidateID, content))
		if len(response.Events) == limit {
			break
		}
	}

	h.logCompleted(ctx, "", len(ids), len(response.Events))
	return response, nil
}

// parseEventID rejects anything that is not a UUID before it can reach a
// query or a similarity lookup, and answers with the canonical form so the
// id it reports back is the id it looked up.
func parseEventID(value string) (string, error) {
	eventID, err := uuid.Parse(value)
	if err != nil {
		return "", status.Error(codes.InvalidArgument, "invalid event id")
	}
	return eventID.String(), nil
}

// neighbours keeps the store's ranking while dropping the source event, so an
// event never appears in the list of events like itself.
func neighbours(ids []string, sourceID string) []string {
	filtered := make([]string, 0, len(ids))
	for _, id := range ids {
		if id == sourceID {
			continue
		}
		filtered = append(filtered, id)
	}
	return filtered
}

// logCompleted records what one request did in counts only: how many
// neighbours the store offered after the source was dropped, and how many
// Event Service confirmed. A reason marks an answer that stopped early.
func (h *Handler) logCompleted(ctx context.Context, reason string, candidateCount, returned int) {
	attributes := []any{
		"operation", Operation,
		"outcome", "success",
		"candidates", candidateCount,
		"returned", returned,
	}
	if reason != "" {
		attributes = append(attributes, "reason", reason)
	}
	h.logger.InfoContext(ctx, "similar_completed", attributes...)
}
