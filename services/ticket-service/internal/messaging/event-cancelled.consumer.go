package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/eventa/ticket-service/internal/cancellation"
	"github.com/google/uuid"
	"github.com/segmentio/kafka-go"
)

type EventCancelledConsumer struct {
	reader       *kafka.Reader
	cancellation *cancellation.Service
}

func NewEventCancelledConsumer(brokers []string, topic, group string, service *cancellation.Service) *EventCancelledConsumer {
	return &EventCancelledConsumer{reader: kafka.NewReader(kafka.ReaderConfig{Brokers: brokers, Topic: topic, GroupID: group, MinBytes: 1, MaxBytes: 1 << 20}), cancellation: service}
}

type cancelledEvent struct {
	MessageID string `json:"messageId"`
	EventID   string `json:"eventId"`
	Type      string `json:"type"`
}

var errPermanentCancellation = errors.New("permanent event cancellation failure")

// ConsumeOne processes one Event lifecycle record. Facts other than
// event.cancelled.v1 are acknowledged and skipped so the shared lifecycle
// topic can carry publication and future facts without stalling Ticket.
// A failed cancellation record is never committed or bypassed.
func (c *EventCancelledConsumer) ConsumeOne(ctx context.Context) error {
	message, err := c.reader.FetchMessage(ctx)
	if err != nil {
		return err
	}
	event, skip, err := decodeEventCancelled(message.Value)
	if skip {
		return c.reader.CommitMessages(ctx, message)
	}
	if err != nil {
		return err
	}
	if err := c.cancellation.CancelEvent(ctx, cancellation.Cancellation{MessageID: event.MessageID, EventID: event.EventID}); err != nil {
		return err
	}
	return c.reader.CommitMessages(ctx, message)
}

// decodeEventCancelled returns skip=true for valid lifecycle facts Ticket does
// not own. Incomplete or malformed cancellation facts are permanent failures.
func decodeEventCancelled(value []byte) (event cancelledEvent, skip bool, err error) {
	var parsed cancelledEvent
	if err := json.Unmarshal(value, &parsed); err != nil {
		return cancelledEvent{}, false, fmt.Errorf("%w: invalid json", errPermanentCancellation)
	}
	if parsed.Type != "event.cancelled.v1" {
		return cancelledEvent{}, true, nil
	}
	if parsed.MessageID == "" || parsed.EventID == "" {
		return cancelledEvent{}, false, fmt.Errorf("%w: incomplete event", errPermanentCancellation)
	}
	if _, err := uuid.Parse(parsed.MessageID); err != nil {
		return cancelledEvent{}, false, fmt.Errorf("%w: invalid message id", errPermanentCancellation)
	}
	if _, err := uuid.Parse(parsed.EventID); err != nil {
		return cancelledEvent{}, false, fmt.Errorf("%w: invalid event id", errPermanentCancellation)
	}
	return parsed, false, nil
}

func (c *EventCancelledConsumer) Run(ctx context.Context, onError func(error)) {
	for ctx.Err() == nil {
		if err := c.ConsumeOne(ctx); err != nil {
			if ctx.Err() != nil {
				return
			}
			onError(err)
			return
		}
	}
}

func (c *EventCancelledConsumer) Close() error { return c.reader.Close() }
