// Package topology declares the queue shapes the auth consumers read from and
// publish retries to. Queues are service-owned, so the consumer asserts its
// own topology before it starts.
package topology

import (
	"fmt"

	amqp "github.com/rabbitmq/amqp091-go"
)

// Declare asserts a quorum work queue plus one single-message-TTL delay queue
// per retry delay. Delayed retries dead-letter back onto the work queue, so a
// retry is an ordinary durable message that the broker releases when its TTL
// elapses.
func Declare(channel *amqp.Channel, queue string, retryDelaysMS []int) error {
	if _, err := channel.QueueDeclare(queue, true, false, false, false, amqp.Table{
		"x-delivery-limit": int32(-1),
		"x-queue-type":     "quorum",
	}); err != nil {
		return fmt.Errorf("declare queue %s: %w", queue, err)
	}

	for _, delayMS := range retryDelaysMS {
		delayQueue := fmt.Sprintf("%s.retry.%dms", queue, delayMS)
		if _, err := channel.QueueDeclare(delayQueue, true, false, false, false, amqp.Table{
			"x-dead-letter-exchange":    "",
			"x-dead-letter-routing-key": queue,
			"x-dead-letter-strategy":    "at-least-once",
			"x-message-ttl":             int32(delayMS),
			"x-overflow":                "reject-publish",
			"x-queue-type":              "quorum",
		}); err != nil {
			return fmt.Errorf("declare retry queue %s: %w", delayQueue, err)
		}
	}

	return nil
}

// RetryQueueName returns the delay queue that releases a retry no later than
// delayMS, falling back to the longest delay when the wait is longer than the
// ladder.
func RetryQueueName(queue string, retryDelaysMS []int, delayMS int) string {
	selected := retryDelaysMS[len(retryDelaysMS)-1]
	for _, candidate := range retryDelaysMS {
		if delayMS <= candidate {
			selected = candidate
			break
		}
	}
	return fmt.Sprintf("%s.retry.%dms", queue, selected)
}
