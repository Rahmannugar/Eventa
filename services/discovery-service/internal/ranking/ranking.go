// Package ranking answers one bounded similarity request. The page bounds,
// the candidate handling, and the response shape live here so Discovery's
// similarity APIs — recommendations and similar events — cannot drift apart
// as each one is added.
package ranking

import (
	"context"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	discoveryv1 "github.com/eventa/discovery-service/internal/gen/eventa/discovery/v1"
	"github.com/eventa/discovery-service/internal/index"
	"github.com/eventa/discovery-service/internal/semantic"
)

// Bounds keep one request's work proportionate: the caller asks for a page,
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

// Resolver is the boundary Discovery uses for Event Service's authority over
// Discovery's own candidates. Event Service applies publication and
// availability; Discovery never reads its database.
type Resolver interface {
	ListRecommendableEvents(ctx context.Context, eventIDs []string) (map[string]*index.Content, error)
}

// ParseLimit treats the proto3 default as "use the default page" and rejects
// anything outside the supported range rather than silently clamping it.
func ParseLimit(raw int32) (int, error) {
	if raw == 0 {
		return DefaultLimit, nil
	}
	if raw < 1 || raw > MaxLimit {
		return 0, status.Error(codes.InvalidArgument, "invalid limit")
	}
	return int(raw), nil
}

// CandidateLimit sizes the similarity search so a few candidates dropped by
// Event Service still leave a full page.
func CandidateLimit(limit int) int {
	candidates := limit * candidateOverfetch
	if candidates < minCandidates {
		return minCandidates
	}
	if candidates > maxCandidates {
		return maxCandidates
	}
	return candidates
}

// UniqueIDs keeps candidate order while removing duplicates, so the ranking
// the store produced is the order Discovery resolves and answers in.
func UniqueIDs(candidates []semantic.Candidate) []string {
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

// ResolveError translates an Event Service failure into the status Discovery
// reports, keeping a slow Event Service distinguishable from an unreachable
// one. The message is the calling API's own wording for an unavailable answer.
func ResolveError(err error, message string) error {
	switch status.Code(err) {
	case codes.DeadlineExceeded:
		return status.Error(codes.DeadlineExceeded, "event service did not answer in time")
	case codes.Unavailable, codes.Canceled:
		return status.Error(codes.Unavailable, message)
	default:
		return status.Error(codes.Internal, message)
	}
}

// ToResult renders one resolved event in the same shape search answers with,
// so a client can render both without a second mapping.
func ToResult(eventID string, content *index.Content) *discoveryv1.EventSearchResult {
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
