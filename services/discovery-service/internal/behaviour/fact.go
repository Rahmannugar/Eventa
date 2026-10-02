// Package behaviour owns the Discovery-owned behavioural preference evidence:
// the durable inbox that makes the two shared topics idempotent, the rows that
// record what an attendee purchased and attended, and the bounded read the
// preference rendering consumes.
package behaviour

import (
	"encoding/json"
	"regexp"
	"time"
)

const (
	// OrderPaidType is the only Commerce fact Discovery acts on. The order
	// topic also carries refunds, which are acknowledged and skipped.
	OrderPaidType = "commerce.order-paid.v1"
	// CheckedInType is the only Ticket fact Discovery acts on. The check-in
	// topic is Discovery's alone for now, but the same skip rule holds if
	// another fact type appears later.
	CheckedInType = "ticket.checked-in.v1"
)

// Operation is the bounded operation name every metric and log line for this
// path carries.
const Operation = "discovery.attendee_behaviour"

const (
	// KafkaCommerceClientID and KafkaCheckInClientID identify each
	// consumer's connections to the broker.
	KafkaCommerceClientID = "eventa-discovery-behaviour-commerce"
	KafkaCheckInClientID  = "eventa-discovery-behaviour-checkin"
)

// Kind is one tier of behavioural evidence. The recommendation rendering
// weights the tiers attended > purchased > claimed.
type Kind string

const (
	KindPurchased Kind = "purchased"
	KindAttended  Kind = "attended"
)

// ParseKind classifies one record on the two shared topics.
type ParseKind int

const (
	// ParseRejected means the record claimed to be a fact Discovery acts on
	// but does not satisfy its contract, so its offset must not advance.
	ParseRejected ParseKind = iota
	// ParseForeign means a fact type this service does not own. It is
	// acknowledged and skipped so a shared topic never stalls.
	ParseForeign
	// ParseOrderPaid and ParseCheckedIn are the two facts Discovery acts on.
	ParseOrderPaid
	ParseCheckedIn
)

// Fact is one behavioural record after validation. It carries only the fields
// Discovery consumes; the rest of both contracts stays ignored.
type Fact struct {
	Type       string
	Kind       Kind
	MessageID  string
	AttendeeID string
	EventID    string
	OccurredAt time.Time
}

// uuidPattern accepts UUID versions 1 to 5 with the RFC 4122 variant, the
// same shape every other service requires of an identity field.
var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// timestampField names the occurrence instant each fact type carries.
const (
	paidAtField      = "paidAt"
	checkedInAtField = "checkedInAt"
)

// ParseFact reads a Kafka record value. Unknown keys are ignored so the fact
// contracts can grow without breaking this consumer.
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
	switch factType {
	case OrderPaidType, CheckedInType:
	default:
		return ParseForeign, Fact{Type: factType}, factType
	}

	messageID, ok := record["messageId"].(string)
	if !ok || !uuidPattern.MatchString(messageID) {
		return ParseRejected, Fact{}, ""
	}
	attendeeID, ok := record["attendeeId"].(string)
	if !ok || !uuidPattern.MatchString(attendeeID) {
		return ParseRejected, Fact{}, ""
	}
	eventID, ok := record["eventId"].(string)
	if !ok || !uuidPattern.MatchString(eventID) {
		return ParseRejected, Fact{}, ""
	}

	occurrenceField := paidAtField
	kind := KindPurchased
	parsedKind := ParseOrderPaid
	if factType == CheckedInType {
		occurrenceField = checkedInAtField
		kind = KindAttended
		parsedKind = ParseCheckedIn
	}

	occurredRaw, ok := record[occurrenceField].(string)
	if !ok || !timestamp(occurredRaw) {
		return ParseRejected, Fact{}, ""
	}
	occurredAt, _ := time.Parse(time.RFC3339, occurredRaw)

	return parsedKind, Fact{
		Type:       factType,
		Kind:       kind,
		MessageID:  messageID,
		AttendeeID: attendeeID,
		EventID:    eventID,
		OccurredAt: occurredAt,
	}, ""
}

// timestamp validates an ISO-8601 instant, the only timestamp shape Commerce
// and Ticket write into these facts.
func timestamp(raw string) bool {
	if raw == "" {
		return false
	}
	_, err := time.Parse(time.RFC3339, raw)
	return err == nil
}
