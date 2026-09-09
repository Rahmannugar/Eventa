package messaging

import (
	"context"
	"encoding/json"
	"time"

	"github.com/eventa/ticket-service/internal/queries"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/segmentio/kafka-go"
)

type CheckInPublisher struct {
	pool   *pgxpool.Pool
	writer *kafka.Writer
}

func NewCheckInPublisher(pool *pgxpool.Pool, brokers []string, topic string) *CheckInPublisher {
	return &CheckInPublisher{pool: pool, writer: &kafka.Writer{Addr: kafka.TCP(brokers...), Topic: topic, Balancer: &kafka.Hash{}}}
}

func (p *CheckInPublisher) Close() error { return p.writer.Close() }

// Run drains committed check-in outbox rows and marks them published only after Kafka accepts them.
func (p *CheckInPublisher) Run(ctx context.Context, onError func(error)) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := p.publishBatch(ctx); err != nil {
				onError(err)
			}
		}
	}
}

func (p *CheckInPublisher) publishBatch(ctx context.Context) error {
	rows, err := queries.New(p.pool).ListPendingCheckInEvents(ctx, 50)
	if err != nil {
		return err
	}
	for _, row := range rows {
		event, err := queries.New(p.pool).GetCheckInEvent(ctx, row.EventID)
		if err != nil {
			return err
		}
		payload, err := json.Marshal(map[string]any{"eventId": uuid.UUID(event.EventID.Bytes).String(), "ticketId": uuid.UUID(event.TicketID.Bytes).String(), "attendeeId": uuid.UUID(event.AttendeeID.Bytes).String(), "checkedInAt": event.CheckedInAt.Time.UTC().Format(time.RFC3339Nano), "type": "ticket.checked-in.v1"})
		if err != nil {
			return err
		}
		if err := p.writer.WriteMessages(ctx, kafka.Message{Key: event.TicketID.Bytes[:], Value: payload}); err != nil {
			return err
		}
		if err := queries.New(p.pool).MarkCheckInEventPublished(ctx, row.EventID); err != nil {
			return err
		}
	}
	return nil
}
