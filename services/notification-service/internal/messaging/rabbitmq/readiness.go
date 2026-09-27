package rabbitmq

import (
	"context"
	"errors"
)

// Readiness adapts the client to the health checker contract. It reports the
// state of the process's own connection field and never probes the broker, so
// readiness cannot be held open by a network round trip.
type Readiness struct {
	Client *Client
}

// Ready fails while the process has no live broker connection.
func (r Readiness) Ready(context.Context) error {
	if !r.Client.Connected() {
		return errors.New("rabbitmq connection closed")
	}
	return nil
}
