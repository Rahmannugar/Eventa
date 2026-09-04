package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/eventa/ticket-service/internal/issuance"
	"github.com/segmentio/kafka-go"
)

type OrderPaidConsumer struct {
	reader   *kafka.Reader
	issuance *issuance.IssuanceService
}

func NewOrderPaidConsumer(brokers []string, topic, group string, service *issuance.IssuanceService) *OrderPaidConsumer {
	return &OrderPaidConsumer{reader: kafka.NewReader(kafka.ReaderConfig{Brokers: brokers, Topic: topic, GroupID: group, MinBytes: 1, MaxBytes: 1 << 20}), issuance: service}
}

type paidOrderMessage struct {
	MessageID, OrderID, AttendeeID, EventID, TicketTypeID string
	Quantity                                              int
	Type                                                  string
}

var errPermanentMessage = errors.New("permanent paid-order message failure")

// ConsumeOne processes one paid-order fact and acknowledges it only after durable issuance commits.
func (c *OrderPaidConsumer) ConsumeOne(ctx context.Context) error {
	message, err := c.reader.FetchMessage(ctx)
	if err != nil {
		return err
	}
	event, err := decodePaidOrder(message.Value)
	if errors.Is(err, errPermanentMessage) {
		return c.reader.CommitMessages(ctx, message)
	}
	if err != nil {
		return err
	}
	if err := c.issuance.IssuePaidOrder(ctx, issuance.PaidOrder{MessageID: issuance.ID(event.MessageID), OrderID: issuance.ID(event.OrderID), AttendeeID: issuance.ID(event.AttendeeID), EventID: issuance.ID(event.EventID), TicketTypeID: issuance.ID(event.TicketTypeID), Quantity: event.Quantity}); err != nil {
		return err
	}
	return c.reader.CommitMessages(ctx, message)
}

// decodePaidOrder rejects records that cannot ever become valid through retry.
func decodePaidOrder(value []byte) (paidOrderMessage, error) {
	var event paidOrderMessage
	if err := json.Unmarshal(value, &event); err != nil {
		return paidOrderMessage{}, fmt.Errorf("%w: invalid json", errPermanentMessage)
	}
	if event.Type != "commerce.order-paid.v1" {
		return paidOrderMessage{}, fmt.Errorf("%w: unexpected event type", errPermanentMessage)
	}
	if event.MessageID == "" || event.OrderID == "" || event.AttendeeID == "" || event.EventID == "" || event.TicketTypeID == "" || event.Quantity < 1 {
		return paidOrderMessage{}, fmt.Errorf("%w: incomplete event", errPermanentMessage)
	}
	return event, nil
}

func (c *OrderPaidConsumer) Close() error { return c.reader.Close() }

func (c *OrderPaidConsumer) Run(ctx context.Context, onError func(error)) {
	for ctx.Err() == nil {
		if err := c.ConsumeOne(ctx); err != nil {
			if ctx.Err() != nil {
				return
			}
			onError(err)
		}
	}
}
