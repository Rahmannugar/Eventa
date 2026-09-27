// Package kafka owns the group membership, offset commits and restart policy
// for the lifecycle facts this service consumes. Parsing and side effects live
// with the domain that owns them.
package kafka

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/segmentio/kafka-go"

	"github.com/eventa/notification-service/internal/errtype"
	"github.com/eventa/notification-service/internal/logging"
	"github.com/eventa/notification-service/internal/telemetry"
)

const (
	// retryMinMS and retryMaxMS bound the restart backoff.
	retryMinMS = 1_000
	retryMaxMS = 30_000
	// healthyRunReset is how long a run must survive before its failures are
	// counted from scratch again.
	healthyRunReset = 60 * time.Second
	// shutdownWait bounds how long shutdown waits for the loop to unwind.
	shutdownWait = 5 * time.Second
)

// Handler processes one record. Returning nil commits its offset; any other
// error leaves the offset alone, so the same record is redelivered after the
// restart backoff.
type Handler func(ctx context.Context, headers map[string]any, value []byte) error

// Consumer runs one group member over one topic with manual commits.
type Consumer struct {
	Brokers  []string
	Topic    string
	Group    string
	ClientID string
	// FailureEvent and Operation name the restart failure the handler's domain
	// expects in its logs.
	FailureEvent string
	Operation    string
	Handler      Handler

	logger *slog.Logger
	cancel context.CancelFunc
	done   chan struct{}
	once   sync.Once
}

// NewConsumer wires a consumer. The emitting context matches the class the
// TypeScript service logged from.
func NewConsumer(contextName string, brokers []string, topic, group, clientID, failureEvent, operation string, handler Handler) *Consumer {
	return &Consumer{
		Brokers:      brokers,
		Topic:        topic,
		Group:        group,
		ClientID:     clientID,
		FailureEvent: failureEvent,
		Operation:    operation,
		Handler:      handler,
		logger:       logging.New(contextName),
		done:         make(chan struct{}),
	}
}

// Start begins the supervised loop in the background.
func (c *Consumer) Start() {
	ctx, cancel := context.WithCancel(context.Background())
	c.cancel = cancel
	go func() {
		defer close(c.done)
		c.run(ctx)
	}()
}

// Stop cancels the loop and waits up to the shutdown budget for it to unwind.
// The reader closes last, so the group leaves cleanly.
func (c *Consumer) Stop() {
	c.once.Do(func() {
		if c.cancel != nil {
			c.cancel()
		}
	})
	if c.done == nil {
		return
	}
	select {
	case <-c.done:
	case <-time.After(shutdownWait * time.Millisecond):
	}
}

func (c *Consumer) run(ctx context.Context) {
	attempt := 0
	for {
		if ctx.Err() != nil {
			return
		}

		startedAt := time.Now()
		err := c.consumeOnce(ctx)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			c.logger.Error(c.FailureEvent,
				"error_type", errtype.Of(err),
				"operation", c.Operation,
				"attempt", attempt+1)
		}

		if time.Since(startedAt) >= healthyRunReset {
			attempt = 0
		} else {
			attempt++
		}

		if !sleep(ctx, restartDelay(attempt)) {
			return
		}
	}
}

// consumeOnce opens a reader, handles records until one fails or the context is
// cancelled, then releases the reader.
func (c *Consumer) consumeOnce(ctx context.Context) error {
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:        c.Brokers,
		Topic:          c.Topic,
		GroupID:        c.Group,
		Dialer:         &kafka.Dialer{ClientID: c.ClientID, Timeout: 10 * time.Second, DualStack: true},
		MinBytes:       1,
		MaxBytes:       1 << 20,
		MaxWait:        time.Second,
		StartOffset:    kafka.FirstOffset,
		CommitInterval: 0,
	})
	defer func() {
		if err := reader.Close(); err != nil {
			c.logger.Warn("kafka_consumer_disconnect_failed", "error_type", errtype.Of(err))
		}
	}()

	for {
		message, err := reader.FetchMessage(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}

		headers := headerMap(message.Headers)
		parent := telemetry.ExtractHeaders(ctx, headers)
		if err := c.Handler(parent, headers, message.Value); err != nil {
			return err
		}

		if err := reader.CommitMessages(ctx, message); err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
	}
}

// headerMap converts Kafka headers into the header shape the propagator reads.
// A repeated key keeps its first value, matching the TypeScript reader.
func headerMap(headers []kafka.Header) map[string]any {
	if len(headers) == 0 {
		return nil
	}
	values := make(map[string]any, len(headers))
	for _, header := range headers {
		if _, seen := values[header.Key]; !seen {
			values[header.Key] = header.Value
		}
	}
	return values
}

// restartDelay is 1s, 2s, 4s, 8s, 16s, then the 30s ceiling.
func restartDelay(attempt int) time.Duration {
	power := max(attempt, 1) - 1
	if power > 5 {
		power = 5
	}
	delayMS := retryMinMS << power
	if delayMS > retryMaxMS {
		delayMS = retryMaxMS
	}
	return time.Duration(delayMS) * time.Millisecond
}

func sleep(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
