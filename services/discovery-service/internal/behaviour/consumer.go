package behaviour

import (
	"context"

	"github.com/eventa/discovery-service/internal/messaging/kafka"
)

// Handler adapts Ingest to the supervised consumer. Returning the parse
// failure for a rejected record is what leaves its offset uncommitted.
func (s *Ingest) Handler() kafka.Handler {
	return func(ctx context.Context, _ map[string]any, value []byte) error {
		_, err := s.Ingest(ctx, value)
		return err
	}
}
