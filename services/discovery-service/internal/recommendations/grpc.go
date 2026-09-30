// Package recommendations ranks published events for one attendee from the
// interests that attendee has saved. Discovery owns the preference record and
// the ranking; Event Service decides which of the candidates it still serves.
package recommendations

import (
	"context"
	"log/slog"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	discoveryv1 "github.com/eventa/discovery-service/internal/gen/eventa/discovery/v1"
	"github.com/eventa/discovery-service/internal/interests"
	"github.com/eventa/discovery-service/internal/ranking"
	"github.com/eventa/discovery-service/internal/semantic"
)

// Operation is the stable operation name this API reports under.
const Operation = "discovery.recommendations"

// Handler serves Discovery's recommendation RPC over the preference record
// Discovery owns, the semantic store, and the Event Service boundary.
type Handler struct {
	discoveryv1.UnimplementedDiscoveryServiceServer
	interests *interests.Repository
	store     semantic.Store
	events    ranking.Resolver
	logger    *slog.Logger
}

// NewHandler binds the preference record, the store, and the Event Service
// boundary to the service logger.
func NewHandler(repository *interests.Repository, store semantic.Store, events ranking.Resolver, logger *slog.Logger) *Handler {
	return &Handler{interests: repository, store: store, events: events, logger: logger}
}

// RecommendEvents answers with the events that best match the attendee's saved
// interests, ranked by the store and then confirmed by Event Service. An
// attendee with no saved interests gets an empty list: that is the cold-start
// position, not a failure. No interest text is logged.
func (h *Handler) RecommendEvents(ctx context.Context, request *discoveryv1.RecommendEventsRequest) (*discoveryv1.RecommendEventsResponse, error) {
	attendeeID, err := interests.ParseAttendeeID(request.GetAttendeeId())
	if err != nil {
		return nil, err
	}
	limit, err := ranking.ParseLimit(request.GetLimit())
	if err != nil {
		return nil, err
	}

	response := &discoveryv1.RecommendEventsResponse{
		AttendeeId: attendeeID.String(),
		Events:     []*discoveryv1.EventSearchResult{},
	}

	stored, err := h.interests.Get(ctx, attendeeID)
	if err != nil {
		return nil, status.Error(codes.Internal, "recommendations unavailable")
	}
	if stored == nil || len(stored.Interests) == 0 {
		h.logCompleted(ctx, "no_interests", 0, 0, 0)
		return response, nil
	}
	interestCount := len(stored.Interests)

	query := semantic.Truncate(semantic.BuildPreferences(stored.Interests))
	candidates, err := h.store.Search(ctx, query, ranking.CandidateLimit(limit))
	if err != nil {
		h.logger.WarnContext(ctx, "recommendations_store_failed",
			"operation", Operation,
			"outcome", "failed",
			"error_type", semantic.ErrorClass(err),
		)
		return nil, status.Error(codes.Unavailable, "recommendations unavailable")
	}

	ids := ranking.UniqueIDs(candidates)
	if len(ids) == 0 {
		h.logCompleted(ctx, "no_candidates", interestCount, 0, 0)
		return response, nil
	}

	resolved, err := h.events.ListRecommendableEvents(ctx, ids)
	if err != nil {
		h.logger.WarnContext(ctx, "recommendations_resolve_failed",
			"operation", Operation,
			"outcome", "failed",
			"error_type", semantic.ErrorClass(err),
		)
		return nil, ranking.ResolveError(err, "recommendations unavailable")
	}

	for _, eventID := range ids {
		content := resolved[eventID]
		if content == nil {
			continue
		}
		response.Events = append(response.Events, ranking.ToResult(eventID, content))
		if len(response.Events) == limit {
			break
		}
	}

	h.logCompleted(ctx, "", interestCount, len(ids), len(response.Events))
	return response, nil
}

// logCompleted records what one request did in counts only: how many interests
// it read, how many candidates the store offered, and how many events Event
// Service confirmed. A reason marks an answer that stopped early.
func (h *Handler) logCompleted(ctx context.Context, reason string, interestCount, candidateCount, returned int) {
	attributes := []any{
		"operation", Operation,
		"outcome", "success",
		"interests", interestCount,
		"candidates", candidateCount,
		"returned", returned,
	}
	if reason != "" {
		attributes = append(attributes, "reason", reason)
	}
	h.logger.InfoContext(ctx, "recommendations_completed", attributes...)
}
