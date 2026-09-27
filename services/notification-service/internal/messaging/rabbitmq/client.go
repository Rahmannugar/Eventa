// Package rabbitmq owns the service's single AMQP connection and the channels
// multiplexed over it. Domain code depends on the capability it exposes, not on
// the broker client, and the connection is a process-wide singleton created
// when the service starts and closed once during shutdown.
package rabbitmq

import (
	"context"
	"fmt"
	"log/slog"
	"net"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/eventa/notification-service/internal/errtype"
)

// Client hands out channels memoised by purpose. A purpose string names why a
// channel exists, so concurrent callers asking for the same purpose share one
// channel and a closed channel is recreated on the next request.
type Client struct {
	url            string
	connectTimeout time.Duration
	logger         *slog.Logger

	mu       sync.Mutex
	conn     *amqp.Connection
	channels map[string]*channelEntry
	closing  bool
}

type channelEntry struct {
	channel *amqp.Channel
	confirm bool
	purpose string
}

// New builds a client. The connection itself is opened lazily by Connect so a
// startup failure is reported once, at startup.
func New(url string, connectTimeout time.Duration, logger *slog.Logger) *Client {
	return &Client{
		url:            url,
		connectTimeout: connectTimeout,
		logger:         logger,
		channels:       map[string]*channelEntry{},
	}
}

// Connect opens the process-long connection, or fails fast when the broker is
// unreachable.
func (c *Client) Connect() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	_, err := c.connectionLocked()
	return err
}

// Connected reports whether the process still holds a live connection. It is a
// local field check, not a heartbeat: the field clears only when the broker
// connection actually closes.
func (c *Client) Connected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn != nil && !c.conn.IsClosed()
}

// ConsumerChannel returns a non-confirm channel for consuming.
func (c *Client) ConsumerChannel(purpose string) (*amqp.Channel, error) {
	return c.channel(purpose, false)
}

// ConfirmChannel returns a channel in publisher-confirm mode. Confirms are
// awaited per publish, so callers must not overlap publishes on one purpose.
func (c *Client) ConfirmChannel(purpose string) (*amqp.Channel, error) {
	return c.channel(purpose, true)
}

// Close closes every tracked channel and then the connection. Failures are
// swallowed: shutdown must not be blocked by a broker that has already gone.
func (c *Client) Close() {
	c.mu.Lock()
	c.closing = true
	channels := c.channels
	connection := c.conn
	c.channels = map[string]*channelEntry{}
	c.conn = nil
	c.mu.Unlock()

	for _, entry := range channels {
		_ = entry.channel.Close()
	}
	if connection != nil {
		_ = connection.Close()
	}
}

// PublishConfirmed publishes one durable message to a queue and waits for the
// broker to acknowledge it, or fails when the confirmation does not arrive in
// time. Each call owns its confirmation, so a timeout cannot be mistaken for
// the confirmation of a later publish.
func (c *Client) PublishConfirmed(ctx context.Context, purpose, queue string, message amqp.Publishing, timeout time.Duration) error {
	channel, err := c.ConfirmChannel(purpose)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	confirmation, err := channel.PublishWithDeferredConfirmWithContext(ctx, "", queue, false, false, message)
	if err != nil {
		return fmt.Errorf("publish to %s: %w", queue, err)
	}
	if confirmation == nil {
		return fmt.Errorf("publisher confirms are not enabled on %q", purpose)
	}

	acked, err := confirmation.WaitContext(ctx)
	if err != nil {
		return fmt.Errorf("wait for confirm on %s: %w", queue, err)
	}
	if !acked {
		return fmt.Errorf("broker rejected the message published to %s", queue)
	}
	return nil
}

func (c *Client) channel(purpose string, confirm bool) (*amqp.Channel, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if entry, ok := c.channels[purpose]; ok {
		if entry.confirm != confirm {
			return nil, fmt.Errorf("rabbitmq channel %q is already used with confirm=%t", purpose, entry.confirm)
		}
		if !entry.channel.IsClosed() {
			return entry.channel, nil
		}
		delete(c.channels, purpose)
	}

	channel, err := c.openChannelLocked()
	if err != nil {
		return nil, err
	}
	if confirm {
		if err := channel.Confirm(false); err != nil {
			_ = channel.Close()
			return nil, fmt.Errorf("enable publisher confirms: %w", err)
		}
	}

	entry := &channelEntry{channel: channel, confirm: confirm, purpose: purpose}
	c.channels[purpose] = entry
	go c.watchChannel(entry)
	return channel, nil
}

func (c *Client) openChannelLocked() (*amqp.Channel, error) {
	connection, err := c.connectionLocked()
	if err != nil {
		return nil, err
	}
	channel, err := connection.Channel()
	if err == nil {
		return channel, nil
	}
	if !connection.IsClosed() {
		// The connection is alive, so this is a real failure such as an
		// exhausted channel budget. Surface it instead of rebuilding.
		return nil, err
	}

	// The connection died between the check and the call; rebuild it once and
	// retry rather than surfacing a transient failure to the caller.
	c.clearConnectionLocked()
	connection, err = c.connectionLocked()
	if err != nil {
		return nil, err
	}
	return connection.Channel()
}

func (c *Client) connectionLocked() (*amqp.Connection, error) {
	if c.conn != nil && !c.conn.IsClosed() {
		return c.conn, nil
	}

	connection, err := amqp.DialConfig(c.url, amqp.Config{
		Dial: func(network, address string) (net.Conn, error) {
			return net.DialTimeout(network, address, c.connectTimeout)
		},
		Locale: "en_US",
	})
	if err != nil {
		return nil, fmt.Errorf("connect to rabbitmq: %w", err)
	}

	c.conn = connection
	c.closing = false
	go c.watchConnection(connection)
	return connection, nil
}

func (c *Client) watchConnection(connection *amqp.Connection) {
	closeEvents := connection.NotifyClose(make(chan *amqp.Error, 1))
	for closeEvent := range closeEvents {
		if closeEvent != nil && !c.isClosing() {
			c.logger.Error("rabbitmq_connection_error", "error_type", errtype.Of(closeEvent))
		}
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.conn == connection {
		c.clearConnectionLocked()
	}
}

func (c *Client) watchChannel(entry *channelEntry) {
	closeEvents := entry.channel.NotifyClose(make(chan *amqp.Error, 1))
	for closeEvent := range closeEvents {
		if closeEvent != nil && !c.isClosing() {
			c.logger.Error("rabbitmq_channel_error",
				"error_type", errtype.Of(closeEvent),
				"purpose", entry.purpose)
		}
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if current, ok := c.channels[entry.purpose]; ok && current == entry {
		delete(c.channels, entry.purpose)
	}
}

// clearConnectionLocked drops a dead connection and its channels. The broker
// has already torn the channels down, so they are released without a second
// close round trip that would block while a lock is held.
func (c *Client) clearConnectionLocked() {
	c.channels = map[string]*channelEntry{}
	c.conn = nil
}

func (c *Client) isClosing() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closing
}
