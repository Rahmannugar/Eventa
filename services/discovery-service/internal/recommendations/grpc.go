// Package recommendations ranks published events for one attendee from the
// interests that attendee saved and the behaviour Discovery observed.
// Discovery owns the preference rendering and the ranking; Event Service
// decides which of the candidates it still serves.
package recommendations

import (
	"context"
	"log/slog"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/eventa/discovery-service/internal/behaviour"
	discoveryv1 "github.com/eventa/discovery-service/internal/gen/eventa/discovery/v1"
	"github.com/eventa/discovery-service/internal/interests"
	"github.com/eventa/discovery-service/internal/ranking"
	"github.com/eventa/discovery-service/internal/semantic"
)

// Operation is the stable operation name this API reports under.
const Operation = "discovery.recommendations"

// evidenceLimit bounds how many rows of each behaviour kind one render reads.
// The byte budget does the real cutting; this only bounds the Postgres read
// so a long history costs a constant amount of work per request.
const evidenceLimit = 12

// Handler serves Discovery's recommendation RPC over the preference record
// Discovery owns, the behaviour evidence Discovery recorded, the semantic
// store, and the Event Service boundary.
type Handler struct {
	discoveryv1.UnimplementedDiscoveryServiceServer
	interests *interests.Repository
	behaviour *behaviour.Repository
	store     semantic.Store
	events    ranking.Resolver
	logger    *slog.Logger
}

// NewHandler binds the preference record, the behaviour evidence, the store,
// and the Event Service boundary to the service logger.
func NewHandler(repository *interests.Repository, behaviourRepository *behaviour.Repository,
	store semantic.Store, events ranking.Resolver, logger *slog.Logger) *Handler {
	return &Handler{
		interests: repository,
		behaviour: behaviourRepository,
		store:     store,
		events:    events,
		logger:    logger,
	}
}

// RecommendEvents answers with the events that best match the attendee's
// saved interests and behavioural evidence, ranked by the store and then
// confirmed by Event Service. An attendee with neither interests nor
// behaviour gets an empty list: that is the cold-start position, not a
// failure. When the request reports an origin, distance joins the ranking
// as one bounded signal and each answer carries its distance_km. No
// interest or behaviour text is logged.
func (h *Handler) RecommendEvents(ctx context.Context, request *discoveryv1.RecommendEventsRequest) (*discoveryv1.RecommendEventsResponse, error) {
	attendeeID, err := interests.ParseAttendeeID(request.GetAttendeeId())
	if err != nil {
		return nil, err
	}
	limit, err := ranking.ParseLimit(request.GetLimit())
	if err != nil {
		return nil, err
	}
	origin, err := originFromRequest(request.GetOrigin())
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
	attended, err := h.behaviour.Evidence(ctx, attendeeID, behaviour.KindAttended, evidenceLimit)
	if err != nil {
		return nil, status.Error(codes.Internal, "recommendations unavailable")
	}
	purchased, err := h.behaviour.Evidence(ctx, attendeeID, behaviour.KindPurchased, evidenceLimit)
	if err != nil {
		return nil, status.Error(codes.Internal, "recommendations unavailable")
	}

	interestCount := 0
	if stored != nil {
		interestCount = len(stored.Interests)
	}
	if interestCount == 0 && len(attended) == 0 && len(purchased) == 0 {
		h.logCompleted(ctx, "no_preferences", 0, 0, 0, 0, 0, origin != nil)
		return response, nil
	}

	query := semantic.BuildPreferences(
		interestValues(stored),
		toPreferenceEvents(attended),
		toPreferenceEvents(purchased),
	)
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
		h.logCompleted(ctx, "no_candidates", interestCount, len(attended), len(purchased), 0, 0, origin != nil)
		return response, nil
	}
	similarities := similarityByID(candidates)

	resolved, err := h.events.ListRecommendableEvents(ctx, ids)
	if err != nil {
		h.logger.WarnContext(ctx, "recommendations_resolve_failed",
			"operation", Operation,
			"outcome", "failed",
			"error_type", semantic.ErrorClass(err),
		)
		return nil, ranking.ResolveError(err, "recommendations unavailable")
	}

	for _, candidate := range rankCandidates(ids, resolved, similarities, origin) {
		result := ranking.ToResult(candidate.eventID, candidate.content)
		result.DistanceKm = candidate.distance
		response.Events = append(response.Events, result)
		if len(response.Events) == limit {
			break
		}
	}

	h.logCompleted(ctx, "", interestCount, len(attended), len(purchased), len(ids), len(response.Events), origin != nil)
	return response, nil
}

// similarityByID keeps the score the store assigned to each candidate. The
// first occurrence wins, mirroring how UniqueIDs treats a duplicate id.
func similarityByID(candidates []semantic.Candidate) map[string]float32 {
	scores := make(map[string]float32, len(candidates))
	for _, candidate := range candidates {
		if _, seen := scores[candidate.EventID]; !seen {
			scores[candidate.EventID] = candidate.Similarity
		}
	}
	return scores
}

// interestValues reads the saved interests from a record that may not exist,
// so the renderer always receives a slice it can range over.
func interestValues(stored *interests.Row) []string {
	if stored == nil {
		return nil
	}
	return stored.Interests
}

// toPreferenceEvents maps behaviour rows to the renderer's neutral shape.
// Discovery renders only content the projection already holds.
func toPreferenceEvents(rows []behaviour.Evidence) []semantic.PreferenceEvent {
	if len(rows) == 0 {
		return nil
	}
	events := make([]semantic.PreferenceEvent, 0, len(rows))
	for _, row := range rows {
		city := ""
		if row.VenueCity != nil {
			city = *row.VenueCity
		}
		events = append(events, semantic.PreferenceEvent{
			Title:      row.Title,
			Categories: row.Categories,
			City:       city,
		})
	}
	return events
}

// logCompleted records what one request did in counts only: how many
// interests and behaviour rows it read, how many candidates the store
// offered, and how many events Event Service confirmed. A reason marks an
// answer that stopped early, and has_origin marks the ranking the answer
// was ordered by.
func (h *Handler) logCompleted(ctx context.Context, reason string, interestCount, attended, purchased, candidateCount, returned int, hasOrigin bool) {
	attributes := []any{
		"operation", Operation,
		"outcome", "success",
		"interests", interestCount,
		"attended", attended,
		"purchased", purchased,
		"candidates", candidateCount,
		"returned", returned,
		"has_origin", hasOrigin,
	}
	if reason != "" {
		attributes = append(attributes, "reason", reason)
	}
	h.logger.InfoContext(ctx, "recommendations_completed", attributes...)
}
