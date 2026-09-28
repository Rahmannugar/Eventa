// Package lookup resolves the authoritative content of one published event.
// Discovery copies it into its own index and never reads Event Service's
// database.
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

	eventv1 "github.com/eventa/discovery-service/internal/gen/eventa/event/v1"
	"github.com/eventa/discovery-service/internal/index"
	"github.com/eventa/discovery-service/internal/telemetry"
)

// Client owns one connection for the process lifetime.
type Client struct {
	connection *grpc.ClientConn
	client     eventv1.EventServiceClient
	deadline   int
}

// Dial opens the Event Service connection. gRPC dials lazily, so an
// unreachable peer is reported per call rather than at startup.
func Dial(eventURL string, deadlineMS int) (*Client, error) {
	connection, err := grpc.NewClient(eventURL, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial event service: %w", err)
	}
	return &Client{
		connection: connection,
		client:     eventv1.NewEventServiceClient(connection),
		deadline:   deadlineMS,
	}, nil
}

// Close releases the connection.
func (c *Client) Close() error { return c.connection.Close() }

// GetPublishedContent returns the content Event Service still serves for a
// published event. A cancelled or draft event is not served, which Discovery
// records as content it does not have rather than as a failure.
func (c *Client) GetPublishedContent(ctx context.Context, eventID string) (*index.Content, error) {
	ctx, cancel, span := c.call(ctx, "EventService/GetPublishedEvent", "EventService", "GetPublishedEvent")
	defer cancel()

	response, err := c.client.GetPublishedEvent(ctx, &eventv1.GetPublishedEventRequest{EventId: eventID})
	if err != nil {
		telemetry.EndSpan(span, err)
		if status.Code(err) == codes.NotFound {
			return nil, index.ErrContentUnavailable
		}
		return nil, err
	}
	telemetry.EndSpan(span, nil)

	published := response.GetEvent()
	if published == nil {
		return nil, index.ErrContentUnavailable
	}
	venue := published.GetVenue()
	content := &index.Content{
		Title:            published.GetTitle(),
		Description:      published.GetDescription(),
		TimeZone:         published.GetTimeZone(),
		Categories:       published.GetCategories(),
		VenueName:        venue.GetName(),
		VenueCity:        venue.GetCity(),
		VenueCountryCode: venue.GetCountryCode(),
	}
	startsAt, err := parseTimestamp(published.GetStartsAt())
	if err != nil {
		return nil, fmt.Errorf("event %s starts_at: %w", eventID, err)
	}
	endsAt, err := parseTimestamp(published.GetEndsAt())
	if err != nil {
		return nil, fmt.Errorf("event %s ends_at: %w", eventID, err)
	}
	content.StartsAt, content.EndsAt = startsAt, endsAt
	return content, nil
}

func parseTimestamp(raw string) (time.Time, error) {
	if raw == "" {
		return time.Time{}, nil
	}
	return time.Parse(time.RFC3339, raw)
}

// call opens a client span, propagates the active trace context and a request
// id over gRPC metadata, and bounds the call.
func (c *Client) call(ctx context.Context, name, service, method string) (context.Context, context.CancelFunc, trace.Span) {
	ctx, span := telemetry.StartSpan(ctx, name, trace.SpanKindClient,
		attribute.String("rpc.system", "grpc"),
		attribute.String("rpc.service", service),
		attribute.String("rpc.method", method),
	)
	ctx, cancel := context.WithTimeout(ctx, time.Duration(c.deadline)*time.Millisecond)

	headers := metadata.MD{}
	otel.GetTextMapPropagator().Inject(ctx, metadataCarrier(headers))
	headers.Set("x-request-id", uuid.NewString())
	return metadata.NewOutgoingContext(ctx, headers), cancel, span
}

// metadataCarrier adapts gRPC outgoing metadata to the propagator's carrier so
// the active trace context crosses the service boundary with a request id.
type metadataCarrier metadata.MD

func (m metadataCarrier) Get(key string) string {
	values := metadata.MD(m).Get(key)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func (m metadataCarrier) Set(key, value string) { metadata.MD(m).Set(key, value) }

func (m metadataCarrier) Keys() []string {
	keys := make([]string, 0, len(metadata.MD(m)))
	for key := range metadata.MD(m) {
		keys = append(keys, key)
	}
	return keys
}
