// Package cancellation owns the event-cancellation email path: reading ticket
// revocation facts from Kafka, recording the durable work, and delivering the
// email once the outbox relay hands the job back over RabbitMQ.
package cancellation

// The bounded names this domain reports to logs, metrics, spans and brokers.
const (
	// Operation is the Kafka ingest and its business outcome.
	Operation = "notification.event_cancellation_email"
	// DeliveryOperation is the RabbitMQ job consumer.
	DeliveryOperation = "notification.event_cancellation_email_delivery"

	Exchange = "eventa.notification.jobs"
	Queue    = "eventa.notification.event-cancellation-email.v1"
	JobType  = "notification.event-cancellation-email.v1"

	// EventPrefix builds every cancellation log event name.
	EventPrefix = "event_cancellation_email"

	QueueContext        = "EventCancellationEmailQueueTopology"
	JobConsumerContext  = "EventCancellationEmailJobConsumer"
	FactConsumerContext = "TicketRevocationConsumer"
	IngestContext       = "CancellationEmailIngestService"

	TopologyPurpose       = "event-cancellation-email-topology"
	ConsumerPurpose       = "event-cancellation-email-job-consumer"
	RetryPublisherPurpose = "event-cancellation-email-retry-publisher"

	MaxDeliveryAttempts = 3
	ProcessingLeaseMS   = 30_000
	ConsumerPrefetch    = 8
	JobMaxBytes         = 2_048

	KafkaClientID = "eventa-notification-service"
)

// RetryDelaysMS is the attempt ladder: attempt 1 waits 5s, attempt 2 waits 30s.
// Attempt 3 is terminal, so the third delay is never used.
var RetryDelaysMS = []int{5_000, 30_000}
