package cancellation

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

// restartDelay is how long the consumer waits before rebuilding a channel the
// broker closed under it.
const restartDelay = time.Second

// StartQueueTopology asserts the exchange, the work queue and the binding once
// at startup, and reports it ready. The outbox relay publishes to the exchange,
// so it must exist before any cancellation job can arrive.
func StartQueueTopology(client *rabbitmq.Client) error {
	channel, err := client.ConfirmChannel(TopologyPurpose)
	if err != nil {
		return err
	}
	if err := topology.DeclareRouted(channel, Exchange, Queue, Queue, RetryDelaysMS); err != nil {
		return err
	}
	logging.New(QueueContext).Info(EventPrefix+"_queue_ready",
		"exchange", Exchange,
		"queue_name", Queue)
	return nil
}

// JobConsumer is the RabbitMQ reader for cancellation jobs.
type JobConsumer struct {
	client         *rabbitmq.Client
	delivery       *Delivery
	logger         *slog.Logger
	publishTimeout time.Duration

	mu       sync.Mutex
	channel  *amqp.Channel
	tag      string
	stopping bool
}

// NewJobConsumer wires the consumer.
func NewJobConsumer(client *rabbitmq.Client, delivery *Delivery, publishTimeout time.Duration) *JobConsumer {
	return &JobConsumer{
		client:         client,
		delivery:       delivery,
		logger:         logging.New(JobConsumerContext),
		publishTimeout: publishTimeout,
	}
}

// Start opens the consumer channel and begins reading.
func (c *JobConsumer) Start() error {
	channel, err := c.client.ConsumerChannel(ConsumerPurpose)
	if err != nil {
		return err
	}
	if err := topology.DeclareRouted(channel, Exchange, Queue, Queue, RetryDelaysMS); err != nil {
		return err
	}
	if err := channel.Qos(ConsumerPrefetch, 0, false); err != nil {
		return err
	}

	tag := uuid.NewString()
	messages, err := channel.Consume(Queue, tag, false, false, false, false, nil)
	if err != nil {
		return err
	}

	c.mu.Lock()
	c.channel, c.tag = channel, tag
	c.mu.Unlock()

	c.logger.Info(EventPrefix+"_consumer_ready", "prefetch", ConsumerPrefetch, "queue_name", Queue)
	go c.read(channel, messages)
	go c.supervise(channel)
	return nil
}

// read dispatches deliveries one goroutine each, bounded by the prefetch count.
func (c *JobConsumer) read(channel *amqp.Channel, messages <-chan amqp.Delivery) {
	for message := range messages {
		parent := telemetry.ExtractHeaders(context.Background(), message.Headers)
		go c.handleMessage(parent, channel, message)
	}
}

// Stop cancels the consumer tag and stops the restart loop. In-flight messages
// finish or stay unacknowledged, so the broker requeues whatever this service
// did not complete.
func (c *JobConsumer) Stop() {
	c.mu.Lock()
	c.stopping = true
	channel, tag := c.channel, c.tag
	c.channel, c.tag = nil, ""
	c.mu.Unlock()

	if channel != nil && tag != "" {
		_ = channel.Cancel(tag, false)
	}
}

func (c *JobConsumer) supervise(channel *amqp.Channel) {
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
			c.logger.Error(EventPrefix+"_consumer_restart_failed", "error_type", errtype.Of(err))
			continue
		}
		return
	}
}

func (c *JobConsumer) handleMessage(parent context.Context, channel *amqp.Channel, message amqp.Delivery) {
	startedAt := time.Now()

	metrics.AddJobInFlight(1, DeliveryOperation)
	defer metrics.AddJobInFlight(-1, DeliveryOperation)

	for !c.isStopping() && c.activeChannel() == channel {
		spanContext, span := telemetry.StartSpan(parent, "cancellation_email_job.process", trace.SpanKindConsumer,
			telemetry.MessagingAttributes(Queue, "process", "rabbitmq")...)
		outcome, err := c.processMessage(spanContext, channel, message)
		telemetry.EndSpan(span, err)
		if err == nil {
			metrics.RecordJob(time.Since(startedAt), DeliveryOperation, outcome)
			return
		}

		c.logger.ErrorContext(parent, EventPrefix+"_job_consumer_error",
			"error_type", errtype.Of(err),
			"operation", DeliveryOperation)
		time.Sleep(time.Second)
	}
}

func (c *JobConsumer) processMessage(ctx context.Context, channel *amqp.Channel, message amqp.Delivery) (string, error) {
	job, invalid := Validate(message.Body)
	if invalid != nil {
		if invalid.DeliveryID != "" {
			if err := c.delivery.RecordRejected(ctx, invalid.DeliveryID, invalid.FailureCode); err != nil {
				return "", err
			}
		}
		if invalid.DeliveryID != "" {
			c.logger.ErrorContext(ctx, EventPrefix+"_job_rejected",
				"error_code", invalid.FailureCode,
				"operation", DeliveryOperation,
				"delivery_id", invalid.DeliveryID)
		} else {
			c.logger.ErrorContext(ctx, EventPrefix+"_job_rejected",
				"error_code", invalid.FailureCode,
				"operation", DeliveryOperation)
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
		c.logger.InfoContext(ctx, EventPrefix+"_delivery_retry_scheduled",
			"delivery_id", job.DeliveryID,
			"operation", DeliveryOperation,
			"outcome", OutcomeRetry)
		if err := message.Ack(false); err != nil {
			return "", err
		}
		return OutcomeRetry, nil
	}

	c.logTerminal(ctx, job.DeliveryID, outcome.Kind)
	if err := message.Ack(false); err != nil {
		return "", err
	}
	return outcome.Kind, nil
}

func (c *JobConsumer) publishRetry(ctx context.Context, job Job, retryAt time.Time) error {
	waitMS := int(time.Until(retryAt) / time.Millisecond)
	if waitMS < 0 {
		waitMS = 0
	}
	queue := topology.RetryQueueName(Queue, RetryDelaysMS, waitMS)

	spanContext, span := telemetry.StartSpan(ctx, "cancellation_email_job.retry_publish", trace.SpanKindProducer,
		telemetry.MessagingAttributes(queue, "publish", "rabbitmq")...)

	body, err := json.Marshal(map[string]string{
		"deliveryId": job.DeliveryID,
		"type":       JobType,
	})
	if err != nil {
		telemetry.EndSpan(span, err)
		return err
	}

	headers := amqp.Table{}
	otel.GetTextMapPropagator().Inject(spanContext, telemetry.AMQPHeaderCarrier{Headers: headers})

	err = c.client.PublishConfirmed(spanContext, RetryPublisherPurpose, queue, amqp.Publishing{
		ContentType:  "application/json",
		Headers:      headers,
		MessageId:    job.DeliveryID,
		DeliveryMode: amqp.Persistent,
		Timestamp:    time.Now(),
		Type:         JobType,
		Body:         body,
	}, c.publishTimeout)
	telemetry.EndSpan(span, err)
	return err
}

func (c *JobConsumer) logTerminal(ctx context.Context, deliveryID, outcome string) {
	args := []any{
		"delivery_id", deliveryID,
		"operation", DeliveryOperation,
		"outcome", outcome,
	}
	if outcome == OutcomeFailed || outcome == OutcomeRejected {
		c.logger.ErrorContext(ctx, EventPrefix+"_delivery_completed", args...)
		return
	}
	c.logger.InfoContext(ctx, EventPrefix+"_delivery_completed", args...)
}

func (c *JobConsumer) isStopping() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.stopping
}

func (c *JobConsumer) activeChannel() *amqp.Channel {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.channel
}
