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

// ConsumeOne processes one Commerce order lifecycle record. Facts other than
// commerce.order-paid.v1 are acknowledged and skipped so the shared order
// topic can carry refund and future facts without stalling Ticket. A paid-order
// fact is acknowledged only after durable issuance commits.
func (c *OrderPaidConsumer) ConsumeOne(ctx context.Context) error {
	message, err := c.reader.FetchMessage(ctx)
	if err != nil {
		return err
	}
	event, skip, err := decodePaidOrder(message.Value)
	if skip {
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

// decodePaidOrder returns skip=true for valid Commerce order lifecycle facts
// that do not describe a paid order, so the shared order topic can carry
// refund and future facts without stalling Ticket. A paid-order fact that can
// never become valid through retry is a permanent failure.
func decodePaidOrder(value []byte) (paidOrderMessage, bool, error) {
	var event paidOrderMessage
	if err := json.Unmarshal(value, &event); err != nil {
		return paidOrderMessage{}, false, fmt.Errorf("%w: invalid json", errPermanentMessage)
	}
	if event.Type != "commerce.order-paid.v1" {
		return paidOrderMessage{}, true, nil
	}
	if event.MessageID == "" || event.OrderID == "" || event.AttendeeID == "" || event.EventID == "" || event.TicketTypeID == "" || event.Quantity < 1 {
		return paidOrderMessage{}, false, fmt.Errorf("%w: incomplete event", errPermanentMessage)
	}
	return event, false, nil
}

func (c *OrderPaidConsumer) Close() error { return c.reader.Close() }

func (c *OrderPaidConsumer) Run(ctx context.Context, onError func(error)) {
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
