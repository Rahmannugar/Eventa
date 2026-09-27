// Package lookup resolves the two facts the cancellation email needs but must
// never store: the attendee's address and the event's content. Both are narrow
// internal gRPC calls with their own deadline.
package lookup

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	"github.com/eventa/notification-service/internal/cancellation"
	eventv1 "github.com/eventa/notification-service/internal/gen/eventa/event/v1"
	identityv1 "github.com/eventa/notification-service/internal/gen/eventa/identity/v1"
	"github.com/eventa/notification-service/internal/telemetry"
)

// Client owns both connections for the process lifetime.
type Client struct {
	identity         *grpc.ClientConn
	identityClient   identityv1.AttendeeIdentityServiceClient
	event            *grpc.ClientConn
	eventClient      eventv1.EventServiceClient
	identityDeadline int
	eventDeadline    int
}

// Dial opens both connections. gRPC dials lazily, so an unreachable peer is
// reported per call rather than at startup.
func Dial(identityURL string, identityDeadlineMS int, eventURL string, eventDeadlineMS int) (*Client, error) {
	identity, err := grpc.NewClient(identityURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial identity service: %w", err)
	}
	event, err := grpc.NewClient(eventURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial event service: %w", err)
	}
	return &Client{
		identity:         identity,
		identityClient:   identityv1.NewAttendeeIdentityServiceClient(identity),
		event:            event,
		eventClient:      eventv1.NewEventServiceClient(event),
		identityDeadline: identityDeadlineMS,
		eventDeadline:    eventDeadlineMS,
	}, nil
}

// Close releases both connections.
func (c *Client) Close() error {
	first := c.identity.Close()
	if err := c.event.Close(); err != nil && first == nil {
		return err
	}
	return first
}

// GetContact returns the attendee's email address.
func (c *Client) GetContact(ctx context.Context, attendeeID string) (string, error) {
	ctx, cancel, span := c.call(ctx, "AttendeeIdentityService/GetAttendeeContact", "AttendeeIdentityService", "GetAttendeeContact", c.identityDeadline)
	defer cancel()

	response, err := c.identityClient.GetAttendeeContact(ctx, &identityv1.GetAttendeeContactRequest{AttendeeId: attendeeID})
	if err != nil {
		telemetry.EndSpan(span, err)
		if status.Code(err) == codes.NotFound {
			return "", cancellation.ErrAttendeeContactNotFound
		}
		return "", err
	}
	telemetry.EndSpan(span, nil)
	return response.GetEmail(), nil
}

// GetSummary returns the event content the template renders.
func (c *Client) GetSummary(ctx context.Context, eventID string) (cancellation.EventSummary, error) {
	ctx, cancel, span := c.call(ctx, "EventService/GetEventSummary", "EventService", "GetEventSummary", c.eventDeadline)
	defer cancel()

	response, err := c.eventClient.GetEventSummary(ctx, &eventv1.GetEventSummaryRequest{EventId: eventID})
	if err != nil {
		telemetry.EndSpan(span, err)
		if status.Code(err) == codes.NotFound {
			return cancellation.EventSummary{}, cancellation.ErrEventSummaryNotFound
		}
		return cancellation.EventSummary{}, err
	}
	telemetry.EndSpan(span, nil)

	summary := cancellation.EventSummary{EventID: response.GetEventId(), Title: response.GetTitle()}
	if response.StartsAt != nil {
		summary.StartsAt = *response.StartsAt
	}
	if response.TimeZone != nil {
		summary.TimeZone = *response.TimeZone
	}
	if venue := response.GetVenue(); venue != nil {
		summary.VenueName = venue.GetName()
		summary.VenueCity = venue.GetCity()
	}
	return summary, nil
}

// call opens a client span, attaches the request id the TypeScript service set
// and propagated the active trace context over, and bounds the call.
func (c *Client) call(ctx context.Context, name, service, method string, deadlineMS int) (context.Context, context.CancelFunc, trace.Span) {
	ctx, span := telemetry.StartSpan(ctx, name, trace.SpanKindClient,
		attribute.String("rpc.system", "grpc"),
		attribute.String("rpc.service", service),
		attribute.String("rpc.method", method),
	)
	ctx, cancel := context.WithTimeout(ctx, time.Duration(deadlineMS)*time.Millisecond)

	headers := metadata.MD{}
	otel.GetTextMapPropagator().Inject(ctx, metadataCarrier(headers))
	headers.Set("x-request-id", uuid.NewString())
	return metadata.NewOutgoingContext(ctx, headers), cancel, span
}

// metadataCarrier adapts gRPC outgoing metadata to the propagator's carrier so
// the active trace context crosses the service boundary with the request id.
type metadataCarrier metadata.MD

func (m metadataCarrier) Get(key string) string {
	values := metadata.MD(m).Get(key)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func (m metadataCarrier) Set(key, value string) {
	metadata.MD(m).Set(key, value)
}

func (m metadataCarrier) Keys() []string {
	keys := make([]string, 0, len(m))
	for key := range metadata.MD(m) {
		keys = append(keys, key)
	}
	return keys
}
