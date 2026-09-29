package interests

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	discoveryv1 "github.com/eventa/discovery-service/internal/gen/eventa/discovery/v1"
)

// Operation is the stable operation name this API reports under.
const Operation = "discovery.interests"

// Handler serves Discovery's interest RPCs over the preference record the
// service owns. The attendee id comes from the Gateway's authenticated
// session; Discovery never resolves an account itself.
type Handler struct {
	discoveryv1.UnimplementedDiscoveryServiceServer
	repository *Repository
	logger     *slog.Logger
}

// NewHandler binds the record and the service logger.
func NewHandler(repository *Repository, logger *slog.Logger) *Handler {
	return &Handler{repository: repository, logger: logger}
}

// GetAttendeeInterests answers with what the attendee has stored. An attendee
// who has never saved interests gets an empty list — that is the cold-start
// position, not a failure. No interest text is logged.
func (h *Handler) GetAttendeeInterests(ctx context.Context, request *discoveryv1.GetAttendeeInterestsRequest) (*discoveryv1.GetAttendeeInterestsResponse, error) {
	attendeeID, err := ParseAttendeeID(request.GetAttendeeId())
	if err != nil {
		return nil, err
	}

	row, err := h.repository.Get(ctx, attendeeID)
	if err != nil {
		return nil, status.Error(codes.Internal, "interests unavailable")
	}

	response := &discoveryv1.GetAttendeeInterestsResponse{
		AttendeeId: attendeeID.String(),
		Interests:  []string{},
	}
	if row != nil {
		response.Interests = nonNil(row.Interests)
		response.UpdatedAt = row.UpdatedAt.UTC().Format(time.RFC3339)
	}

	h.logger.InfoContext(ctx, "interests_read_completed",
		"operation", Operation,
		"outcome", "success",
		"interests", len(response.Interests),
		"stored", row != nil,
	)
	return response, nil
}

// SetAttendeeInterests replaces the attendee's stored interests in one write.
// The request is bounded and normalised before it reaches the database, so a
// caller is never told it stored more than Discovery actually kept.
func (h *Handler) SetAttendeeInterests(ctx context.Context, request *discoveryv1.SetAttendeeInterestsRequest) (*discoveryv1.SetAttendeeInterestsResponse, error) {
	attendeeID, err := ParseAttendeeID(request.GetAttendeeId())
	if err != nil {
		return nil, err
	}

	interests, err := normalize(request.GetInterests())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid interests")
	}

	row, err := h.repository.Upsert(ctx, attendeeID, interests)
	if err != nil {
		return nil, status.Error(codes.Internal, "interests unavailable")
	}

	h.logger.InfoContext(ctx, "interests_set_completed",
		"operation", Operation,
		"outcome", "success",
		"interests", len(row.Interests),
	)
	return &discoveryv1.SetAttendeeInterestsResponse{
		AttendeeId: row.AttendeeID.String(),
		Interests:  nonNil(row.Interests),
		UpdatedAt:  row.UpdatedAt.UTC().Format(time.RFC3339),
	}, nil
}

// ParseAttendeeID rejects anything that is not a UUID before it can reach a
// query or a recommendation lookup, so a malformed id cannot become a database
// error.
func ParseAttendeeID(value string) (uuid.UUID, error) {
	attendeeID, err := uuid.Parse(value)
	if err != nil {
		return uuid.Nil, status.Error(codes.InvalidArgument, "invalid attendee id")
	}
	return attendeeID, nil
}

func nonNil(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}
