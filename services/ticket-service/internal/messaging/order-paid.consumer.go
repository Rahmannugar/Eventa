package messaging

import (
	"context"
	"encoding/json"
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

// ConsumeOne processes one paid-order fact and acknowledges it only after durable issuance commits.
func (c *OrderPaidConsumer) ConsumeOne(ctx context.Context) error {
	message, err := c.reader.FetchMessage(ctx)
	if err != nil {
		return err
	}
	var event paidOrderMessage
	if err := json.Unmarshal(message.Value, &event); err != nil {
		return fmt.Errorf("invalid paid-order event: %w", err)
	}
	if event.Type != "commerce.order-paid.v1" {
		return fmt.Errorf("unexpected event type")
	}
	if err := c.issuance.IssuePaidOrder(ctx, issuance.PaidOrder{MessageID: issuance.ID(event.MessageID), OrderID: issuance.ID(event.OrderID), AttendeeID: issuance.ID(event.AttendeeID), EventID: issuance.ID(event.EventID), TicketTypeID: issuance.ID(event.TicketTypeID), Quantity: event.Quantity}); err != nil {
		return err
	}
	return c.reader.CommitMessages(ctx, message)
}

func (c *OrderPaidConsumer) Close() error { return c.reader.Close() }
