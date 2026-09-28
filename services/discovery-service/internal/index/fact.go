// Package index owns the Discovery-owned event index: the durable inbox that
// makes the lifecycle stream idempotent, the resolve against Event Service, and
// the row that says which published events exist and which are cancelled.
package index

import (
	"encoding/json"
	"regexp"
	"time"
)

const (
	// PublishedType and CancelledType are the only fact types Event Service
	// publishes on `eventa.event.lifecycle.v1`.
	PublishedType = "event.published.v1"
	CancelledType = "event.cancelled.v1"
)

// Operation is the bounded operation name every metric and log line for this
// path carries.
const Operation = "discovery.event_index"

// KafkaClientID identifies this consumer's connections to the broker.
const KafkaClientID = "eventa-discovery-index"

// ParseKind classifies one record on the shared lifecycle topic.
type ParseKind int

const (
	// ParseRejected means the record claimed to be a lifecycle fact but does
	// not satisfy its contract, so its offset must not advance.
	ParseRejected ParseKind = iota
	// ParseForeign means a fact type this service does not own. It is
	// acknowledged and skipped so the shared topic never stalls.
	ParseForeign
	// ParsePublished and ParseCancelled are the two facts Discovery acts on.
	ParsePublished
	ParseCancelled
)

// Fact is one lifecycle record after validation.
type Fact struct {
	Type        string
	EventID     string
	MessageID   string
	Version     int
	PublishedAt time.Time
	CancelledAt time.Time
}

// uuidPattern accepts UUID versions 1 to 5 with the RFC 4122 variant, the same
// shape every other service requires of an identity field.
var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// ParseFact reads a Kafka record value. Unknown keys are ignored so the fact
// contract can grow without breaking this consumer.
func ParseFact(value []byte) (ParseKind, Fact, string) {
	if value == nil {
		return ParseRejected, Fact{}, ""
	}
	var decoded any
	if err := json.Unmarshal(value, &decoded); err != nil {
		return ParseRejected, Fact{}, ""
	}
	record, ok := decoded.(map[string]any)
	if !ok || record == nil {
		return ParseRejected, Fact{}, ""
	}

	factType, ok := record["type"].(string)
	if !ok {
		return ParseRejected, Fact{}, ""
	}
	if factType != PublishedType && factType != CancelledType {
		return ParseForeign, Fact{Type: factType}, factType
	}

	eventID, ok := record["eventId"].(string)
	if !ok || !uuidPattern.MatchString(eventID) {
		return ParseRejected, Fact{}, ""
	}

	switch factType {
	case PublishedType:
		publishedAt, ok := record["publishedAt"].(string)
		if !ok || !timestamp(publishedAt) {
			return ParseRejected, Fact{}, ""
		}
		version, ok := record["version"].(float64)
		if !ok || version < 0 || version != float64(int(version)) {
			return ParseRejected, Fact{}, ""
		}
		parsed, _ := time.Parse(time.RFC3339, publishedAt)
		return ParsePublished, Fact{
			Type:        factType,
			EventID:     eventID,
			Version:     int(version),
			PublishedAt: parsed,
		}, ""
	default:
		messageID, ok := record["messageId"].(string)
		if !ok || !uuidPattern.MatchString(messageID) {
			return ParseRejected, Fact{}, ""
		}
		cancelledAt, ok := record["cancelledAt"].(string)
		if !ok || !timestamp(cancelledAt) {
			return ParseRejected, Fact{}, ""
		}
		cancelled, _ := time.Parse(time.RFC3339, cancelledAt)
		return ParseCancelled, Fact{
			Type:        factType,
			EventID:     eventID,
			MessageID:   messageID,
			CancelledAt: cancelled,
		}, ""
	}
}

// DedupeKey is the record's stable identity inside its fact type. A cancelled
// fact carries its own message id. A published fact does not: Event Service
// writes at most one `event.published.v1` row per event against the outbox
// primary key `(event_id, event_type)`, so the event id is that fact's stable
// identity and a replay of it is the same fact, not a new one.
func (f Fact) DedupeKey() string {
	if f.MessageID != "" {
		return f.MessageID
	}
	return f.EventID
}

// timestamp validates an ISO-8601 instant, the only timestamp shape Event
// Service writes into a lifecycle fact.
func timestamp(raw string) bool {
	if raw == "" {
		return false
	}
	_, err := time.Parse(time.RFC3339, raw)
	return err == nil
}
