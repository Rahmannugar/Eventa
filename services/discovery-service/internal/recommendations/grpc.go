// Package recommendations ranks published events for one attendee from the
// interests that attendee has saved. Discovery owns the preference record and
// the ranking; Event Service decides which of the candidates it still serves.
package recommendations

import (
	"context"
	"log/slog"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	discoveryv1 "github.com/eventa/discovery-service/internal/gen/eventa/discovery/v1"
	"github.com/eventa/discovery-service/internal/index"
	"github.com/eventa/discovery-service/internal/interests"
	"github.com/eventa/discovery-service/internal/semantic"
)

// Operation is the stable operation name this API reports under.
const Operation = "discovery.recommendations"

// Bounds keep one request's work proportionate: the attendee asks for a page,
// and Discovery asks the store for a bounded multiple of that page so events
// Event Service drops do not leave the answer short.
const (
	// DefaultLimit is the page size when a caller does not ask for one.
	DefaultLimit = 10
	// MaxLimit is the largest page one request may ask for.
	MaxLimit = 20

	candidateOverfetch = 4
	minCandidates      = 10
	maxCandidates      = 50
)

// EventResolver is the boundary Discovery uses for Event Service's authority
// over Discovery's own candidates. Event Service applies publication and
// availability; Discovery never reads its database.
type EventResolver interface {
	ListRecommendableEvents(ctx context.Context, eventIDs []string) (map[string]*index.Content, error)
}

// Handler serves Discovery's recommendation RPC over the preference record
// Discovery owns, the semantic store, and the Event Service boundary.
type Handler struct {
	discoveryv1.UnimplementedDiscoveryServiceServer
	interests *interests.Repository
	store     semantic.Store
	events    EventResolver
	logger    *slog.Logger
}

// NewHandler binds the preference record, the store, and the Event Service
// boundary to the service logger.
func NewHandler(repository *interests.Repository, store semantic.Store, events EventResolver, logger *slog.Logger) *Handler {
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
	limit, err := parseLimit(request.GetLimit())
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
	candidates, err := h.store.Search(ctx, query, candidateLimit(limit))
	if err != nil {
		h.logger.WarnContext(ctx, "recommendations_store_failed",
			"operation", Operation,
			"outcome", "failed",
			"error_type", semantic.ErrorClass(err),
		)
		return nil, status.Error(codes.Unavailable, "recommendations unavailable")
	}

	ids := uniqueIDs(candidates)
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
		return nil, resolveError(err)
	}

	for _, eventID := range ids {
		content := resolved[eventID]
		if content == nil {
			continue
		}
		response.Events = append(response.Events, toResult(eventID, content))
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

// parseLimit treats the proto3 default as "use the default page" and rejects
// anything outside the supported range rather than silently clamping it.
func parseLimit(raw int32) (int, error) {
	if raw == 0 {
		return DefaultLimit, nil
	}
	if raw < 1 || raw > MaxLimit {
		return 0, status.Error(codes.InvalidArgument, "invalid limit")
	}
	return int(raw), nil
}

// candidateLimit sizes the similarity search so a few candidates dropped by
// Event Service still leave a full page.
func candidateLimit(limit int) int {
	candidates := limit * candidateOverfetch
	if candidates < minCandidates {
		return minCandidates
	}
	if candidates > maxCandidates {
		return maxCandidates
	}
	return candidates
}

// uniqueIDs keeps candidate order while removing duplicates, so the ranking
// the store produced is the order Discovery resolves and answers in.
func uniqueIDs(candidates []semantic.Candidate) []string {
	ids := make([]string, 0, len(candidates))
	seen := make(map[string]struct{}, len(candidates))
	for _, candidate := range candidates {
		if _, exists := seen[candidate.EventID]; exists {
			continue
		}
		seen[candidate.EventID] = struct{}{}
		ids = append(ids, candidate.EventID)
	}
	return ids
}

// resolveError translates an Event Service failure into the status Discovery
// reports, keeping a slow Event Service distinguishable from an unreachable
// one.
func resolveError(err error) error {
	switch status.Code(err) {
	case codes.DeadlineExceeded:
		return status.Error(codes.DeadlineExceeded, "event service did not answer in time")
	case codes.Unavailable, codes.Canceled:
		return status.Error(codes.Unavailable, "recommendations unavailable")
	default:
		return status.Error(codes.Internal, "recommendations unavailable")
	}
}

// toResult renders one resolved event in the same shape search answers with,
// so a client can render both without a second mapping.
func toResult(eventID string, content *index.Content) *discoveryv1.EventSearchResult {
	description := content.Description
	startsAt := content.StartsAt.UTC().Format(time.RFC3339)
	endsAt := content.EndsAt.UTC().Format(time.RFC3339)
	timeZone := content.TimeZone
	categories := content.Categories
	if categories == nil {
		categories = []string{}
	}
	return &discoveryv1.EventSearchResult{
		EventId:          eventID,
		Title:            content.Title,
		Description:      &description,
		StartsAt:         &startsAt,
		EndsAt:           &endsAt,
		TimeZone:         &timeZone,
		Categories:       categories,
		VenueName:        optionalString(content.VenueName),
		VenueCity:        optionalString(content.VenueCity),
		VenueCountryCode: optionalString(content.VenueCountryCode),
	}
}

func optionalString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
