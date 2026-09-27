package auth

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	amqp "github.com/rabbitmq/amqp091-go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"

	"github.com/eventa/notification-service/internal/errtype"
	"github.com/eventa/notification-service/internal/logging"
	"github.com/eventa/notification-service/internal/messaging/rabbitmq"
	"github.com/eventa/notification-service/internal/messaging/topology"
	"github.com/eventa/notification-service/internal/metrics"
	"github.com/eventa/notification-service/internal/telemetry"
)

// ConsumerPrefetch bounds how many auth jobs one connection may hold.
const ConsumerPrefetch = 8

// restartDelay is how long the consumer waits before rebuilding a channel the
// broker closed under it.
const restartDelay = time.Second

// Consumer is one running auth job consumer.
type Consumer struct {
	definition     Definition
	client         *rabbitmq.Client
	delivery       *Delivery
	logger         *slog.Logger
	publishTimeout time.Duration

	mu       sync.Mutex
	channel  *amqp.Channel
	tag      string
	stopping bool
}

// NewConsumer wires one consumer for one job definition.
func NewConsumer(definition Definition, client *rabbitmq.Client, delivery *Delivery, publishTimeout time.Duration) *Consumer {
	return &Consumer{
		definition:     definition,
		client:         client,
		delivery:       delivery,
		logger:         logging.New(definition.Context),
		publishTimeout: publishTimeout,
	}
}

// Start asserts the queue topology, opens the consumer channel and begins
// reading.
func (c *Consumer) Start() error {
	channel, err := c.client.ConsumerChannel(c.definition.ConsumerPurpose)
	if err != nil {
		return err
	}
	if err := topology.Declare(channel, c.definition.Queue, RetryDelaysMS); err != nil {
		return err
	}
	if err := channel.Qos(ConsumerPrefetch, 0, false); err != nil {
		return err
	}

	tag := uuid.NewString()
	messages, err := channel.Consume(c.definition.Queue, tag, false, false, false, false, nil)
	if err != nil {
		return err
	}

	c.mu.Lock()
	c.channel, c.tag = channel, tag
	c.mu.Unlock()

	c.logger.Info(c.event("_consumer_ready"), "prefetch", ConsumerPrefetch, "queue_name", c.definition.Queue)
	go c.read(channel, messages)
	go c.supervise(channel)
	return nil
}

// read dispatches deliveries the way the TypeScript consumer did: one
// independent goroutine per message, bounded by the prefetch count, so a slow
// recipient never blocks the channel.
func (c *Consumer) read(channel *amqp.Channel, messages <-chan amqp.Delivery) {
	for message := range messages {
		parent := telemetry.ExtractHeaders(context.Background(), message.Headers)
		go c.handleMessage(parent, channel, message)
	}
}

// Stop cancels the consumer tag and stops the restart loop. In-flight messages
// finish or stay unacknowledged, so the broker requeues whatever this service
// did not complete.
func (c *Consumer) Stop() {
	c.mu.Lock()
	c.stopping = true
	channel, tag := c.channel, c.tag
	c.channel, c.tag = nil, ""
	c.mu.Unlock()

	if channel != nil && tag != "" {
		_ = channel.Cancel(tag, false)
	}
}

// supervise waits for the channel to close, then rebuilds the consumer unless
// the service is shutting down.
func (c *Consumer) supervise(channel *amqp.Channel) {
	closeEvents := channel.NotifyClose(make(chan *amqp.Error, 1))
	for range closeEvents {
	}

	c.mu.Lock()
	stopping := c.stopping
	if c.channel == channel {
		c.channel, c.tag = nil, ""
	}
	c.mu.Unlock()
	if stopping || c.isStopping() {
		return
	}

	for {
		time.Sleep(restartDelay)
		if c.isStopping() {
			return
		}
		if err := c.Start(); err != nil {
			c.logger.Error(c.event("_consumer_restart_failed"), "error_type", errtype.Of(err))
			continue
		}
		return
	}
}

func (c *Consumer) handleMessage(parent context.Context, channel *amqp.Channel, message amqp.Delivery) {
	startedAt := time.Now()
	operation := c.definition.Operation

	metrics.AddJobInFlight(1, operation)
	defer metrics.AddJobInFlight(-1, operation)

	for !c.isStopping() && c.activeChannel() == channel {
		spanContext, span := telemetry.StartSpan(parent, c.event("_job.process"), trace.SpanKindConsumer,
			telemetry.MessagingAttributes(c.definition.Queue, "process", "rabbitmq")...)
		outcome, err := c.processMessage(spanContext, channel, message)
		telemetry.EndSpan(span, err)
		if err == nil {
			metrics.RecordJob(time.Since(startedAt), operation, outcome)
			return
		}

		c.logger.ErrorContext(parent, c.event("_job_consumer_error"),
			"error_type", errtype.Of(err),
			"operation", operation)
		time.Sleep(time.Second)
	}
}

func (c *Consumer) processMessage(ctx context.Context, channel *amqp.Channel, message amqp.Delivery) (string, error) {
	job, invalid := Validate(c.definition, message.ContentType, message.Type, message.MessageId, message.Body)
	if invalid != nil {
		if invalid.JobID != nil {
			if err := c.delivery.RecordRejected(ctx, *invalid.JobID, invalid.FailureCode); err != nil {
				return "", err
			}
		}

		if invalid.JobID != nil {
			c.logger.ErrorContext(ctx, c.event("_job_rejected"),
				"error_code", invalid.FailureCode,
				"operation", c.definition.Operation,
				"job_id", *invalid.JobID,
				"message_id", *invalid.JobID)
		} else {
			c.logger.ErrorContext(ctx, c.event("_job_rejected"),
				"error_code", invalid.FailureCode,
				"operation", c.definition.Operation)
		}
		if err := message.Ack(false); err != nil {
			return "", err
		}
		return OutcomeRejected, nil
	}

	outcome, err := c.delivery.Deliver(ctx, job)
	if err != nil {
		return "", err
	}

	if outcome.Kind == OutcomeRetry {
		if err := c.publishRetry(ctx, job, outcome.RetryAt); err != nil {
			return "", err
		}
		c.logger.InfoContext(ctx, c.event("_delivery_retry_scheduled"),
			"job_id", job.JobID,
			"message_id", job.JobID,
			"operation", c.definition.Operation,
			"outcome", OutcomeRetry)
		if err := message.Ack(false); err != nil {
			return "", err
		}
		return OutcomeRetry, nil
	}

	c.logTerminal(ctx, job.JobID, outcome.Kind)
	if err := message.Ack(false); err != nil {
		return "", err
	}
	return outcome.Kind, nil
}

func (c *Consumer) publishRetry(ctx context.Context, job Job, retryAt time.Time) error {
	waitMS := int(time.Until(retryAt) / time.Millisecond)
	if waitMS < 0 {
		waitMS = 0
	}
	queue := topology.RetryQueueName(c.definition.Queue, RetryDelaysMS, waitMS)

	spanContext, span := telemetry.StartSpan(ctx, c.event("_job.retry_publish"), trace.SpanKindProducer,
		telemetry.MessagingAttributes(queue, "publish", "rabbitmq")...)

	body, err := json.Marshal(newJobPayload(job, c.definition.Secret))
	if err != nil {
		telemetry.EndSpan(span, err)
		return err
	}

	headers := amqp.Table{}
	otel.GetTextMapPropagator().Inject(spanContext, telemetry.AMQPHeaderCarrier{Headers: headers})

	err = c.client.PublishConfirmed(spanContext, c.definition.RetryPublisherPurpose, queue, amqp.Publishing{
		ContentType:  "application/json",
		Headers:      headers,
		MessageId:    job.JobID,
		DeliveryMode: amqp.Persistent,
		Timestamp:    time.Now(),
		Type:         c.definition.JobType,
		Body:         body,
	}, c.publishTimeout)
	telemetry.EndSpan(span, err)
	return err
}

func (c *Consumer) logTerminal(ctx context.Context, jobID, outcome string) {
	event := c.event("_delivery_completed")
	args := []any{
		"job_id", jobID,
		"message_id", jobID,
		"operation", c.definition.Operation,
		"outcome", outcome,
	}
	if outcome == OutcomeFailed || outcome == OutcomeRejected {
		c.logger.ErrorContext(ctx, event, args...)
		return
	}
	c.logger.InfoContext(ctx, event, args...)
}

func (c *Consumer) event(suffix string) string {
	return c.definition.EventPrefix + suffix
}

func (c *Consumer) isStopping() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.stopping
}

func (c *Consumer) activeChannel() *amqp.Channel {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.channel
}

// jobPayload keeps the republished retry body in the field order the validator
// expects, so a retry is indistinguishable from the original job.
type jobPayload struct {
	Code           string `json:"code,omitempty"`
	ExpiresAt      string `json:"expiresAt"`
	JobID          string `json:"jobId"`
	OTP            string `json:"otp,omitempty"`
	RecipientEmail string `json:"recipientEmail"`
	Type           string `json:"type"`
}

func newJobPayload(job Job, secret SecretField) jobPayload {
	payload := jobPayload{
		ExpiresAt:      job.ExpiresAt,
		JobID:          job.JobID,
		RecipientEmail: job.RecipientEmail,
		Type:           job.Type,
	}
	if secret == SecretCode {
		payload.Code = job.Secret
	} else {
		payload.OTP = job.Secret
	}
	return payload
}
