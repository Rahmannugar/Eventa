// Package facts parses and validates the business facts Analytics projects.
// One package owns every fact type so the six consumers share one validation
// contract instead of six drifting ones.
package facts

import (
	"encoding/json"
	"regexp"
	"time"
)

// The fact types Analytics acts on. Everything else on the shared topics is
// foreign and acknowledged without projection work.
const (
	OrderPaidType     = "commerce.order-paid.v1"
	OrderRefundedType = "commerce.order-refunded.v1"
	CheckedInType     = "ticket.checked-in.v1"
	RevokedType       = "ticket.revoked.v1"
	PublishedType     = "event.published.v1"
	CancelledType     = "event.cancelled.v1"
)

// Operation is the bounded operation name every metric and log line for the
// projection path carries.
const Operation = "analytics.performance"

// Kind classifies one record after parsing.
type Kind int

const (
	// KindRejected means the record claimed to be a fact Analytics owns but
	// broke its contract, so its offset must not advance.
	KindRejected Kind = iota
	// KindForeign means a fact type this service does not project. It is
	// acknowledged and skipped so a shared topic never stalls.
	KindForeign
	KindOrderPaid
	KindOrderRefunded
	KindCheckedIn
	KindRevoked
	KindPublished
	KindCancelled
)

// Fact is one record after validation. Only the fields relevant to its type
// are populated.
type Fact struct {
	Type         string
	MessageID    string
	EventID      string
	OrderID      string
	TicketTypeID string
	AttendeeID   string
	Quantity     int
	Currency     string
	TotalMinor   int64
	OccurredAt   time.Time
	PublishedAt  time.Time
	CancelledAt  time.Time
	Version      int
}

// uuidPattern accepts UUID versions 1 to 5 with the RFC 4122 variant, the
// same shape every other service requires of an identity field.
var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// currencyPattern accepts the ISO 4217 three-letter uppercase shape Commerce
// writes into an order snapshot.
var currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

// Parse reads one Kafka record value and validates it against the contract of
// its declared type. Unknown keys are ignored so the fact contract can grow
// without breaking these consumers.
func Parse(value []byte) (Kind, Fact, string) {
	if value == nil {
		return KindRejected, Fact{}, ""
	}
	var decoded any
	if err := json.Unmarshal(value, &decoded); err != nil {
		return KindRejected, Fact{}, ""
	}
	record, ok := decoded.(map[string]any)
	if !ok || record == nil {
		return KindRejected, Fact{}, ""
	}

	factType, ok := record["type"].(string)
	if !ok {
		return KindRejected, Fact{}, ""
	}

	switch factType {
	case OrderPaidType, OrderRefundedType:
		return parseOrderFact(record, factType)
	case CheckedInType:
		return parseCheckedIn(record)
	case RevokedType:
		return parseRevoked(record)
	case PublishedType:
		return parsePublished(record)
	case CancelledType:
		return parseCancelled(record)
	default:
		return KindForeign, Fact{Type: factType}, factType
	}
}

func parseOrderFact(record map[string]any, factType string) (Kind, Fact, string) {
	fact := Fact{Type: factType}

	fact.MessageID, _ = record["messageId"].(string)
	if !uuidPattern.MatchString(fact.MessageID) {
		return KindRejected, Fact{}, ""
	}
	fact.OrderID, _ = record["orderId"].(string)
	if !uuidPattern.MatchString(fact.OrderID) {
		return KindRejected, Fact{}, ""
	}
	fact.EventID, _ = record["eventId"].(string)
	if !uuidPattern.MatchString(fact.EventID) {
		return KindRejected, Fact{}, ""
	}
	fact.TicketTypeID, _ = record["ticketTypeId"].(string)
	if !uuidPattern.MatchString(fact.TicketTypeID) {
		return KindRejected, Fact{}, ""
	}
	fact.AttendeeID, _ = record["attendeeId"].(string)
	if !uuidPattern.MatchString(fact.AttendeeID) {
		return KindRejected, Fact{}, ""
	}

	quantity, ok := record["quantity"].(float64)
	if !ok || quantity < 1 || quantity != float64(int(quantity)) {
		return KindRejected, Fact{}, ""
	}
	fact.Quantity = int(quantity)

	fact.Currency, _ = record["currency"].(string)
	if !currencyPattern.MatchString(fact.Currency) {
		return KindRejected, Fact{}, ""
	}

	totalMinor, ok := record["totalMinor"].(float64)
	if !ok || totalMinor < 0 || totalMinor != float64(int64(totalMinor)) {
		return KindRejected, Fact{}, ""
	}
	fact.TotalMinor = int64(totalMinor)

	timestampKey, kind := "paidAt", KindOrderPaid
	if factType == OrderRefundedType {
		timestampKey, kind = "refundedAt", KindOrderRefunded
	}
	raw, _ := record[timestampKey].(string)
	occurredAt, ok := parseTimestamp(raw)
	if !ok {
		return KindRejected, Fact{}, ""
	}
	fact.OccurredAt = occurredAt
	return kind, fact, ""
}

func parseCheckedIn(record map[string]any) (Kind, Fact, string) {
	fact, ok := parseTicketIdentity(record, CheckedInType)
	if !ok {
		return KindRejected, Fact{}, ""
	}
	raw, _ := record["checkedInAt"].(string)
	occurredAt, exists := parseTimestamp(raw)
	if !exists {
		return KindRejected, Fact{}, ""
	}
	fact.OccurredAt = occurredAt
	return KindCheckedIn, fact, ""
}

func parseRevoked(record map[string]any) (Kind, Fact, string) {
	fact, ok := parseTicketIdentity(record, RevokedType)
	if !ok {
		return KindRejected, Fact{}, ""
	}
	raw, _ := record["revokedAt"].(string)
	occurredAt, exists := parseTimestamp(raw)
	if !exists {
		return KindRejected, Fact{}, ""
	}
	fact.OccurredAt = occurredAt
	return KindRevoked, fact, ""
}

// parseTicketIdentity validates the shared shape of the check-in and revoked
// facts: a message id, a ticket id, the event it belongs to, and a quantity
// of one. These facts do not carry a ticket type, so the projection counts
// tickets without attributing them to a type.
func parseTicketIdentity(record map[string]any, factType string) (Fact, bool) {
	fact := Fact{Type: factType, Quantity: 1}

	fact.MessageID, _ = record["messageId"].(string)
	if !uuidPattern.MatchString(fact.MessageID) {
		return Fact{}, false
	}
	ticketID, _ := record["ticketId"].(string)
	if !uuidPattern.MatchString(ticketID) {
		return Fact{}, false
	}
	fact.EventID, _ = record["eventId"].(string)
	if !uuidPattern.MatchString(fact.EventID) {
		return Fact{}, false
	}
	return fact, true
}

func parsePublished(record map[string]any) (Kind, Fact, string) {
	fact := Fact{Type: PublishedType}

	fact.EventID, _ = record["eventId"].(string)
	if !uuidPattern.MatchString(fact.EventID) {
		return KindRejected, Fact{}, ""
	}
	raw, _ := record["publishedAt"].(string)
	publishedAt, ok := parseTimestamp(raw)
	if !ok {
		return KindRejected, Fact{}, ""
	}
	fact.PublishedAt = publishedAt

	version, ok := record["version"].(float64)
	if !ok || version < 0 || version != float64(int(version)) {
		return KindRejected, Fact{}, ""
	}
	fact.Version = int(version)
	return KindPublished, fact, ""
}

func parseCancelled(record map[string]any) (Kind, Fact, string) {
	fact := Fact{Type: CancelledType}

	fact.MessageID, _ = record["messageId"].(string)
	if !uuidPattern.MatchString(fact.MessageID) {
		return KindRejected, Fact{}, ""
	}
	fact.EventID, _ = record["eventId"].(string)
	if !uuidPattern.MatchString(fact.EventID) {
		return KindRejected, Fact{}, ""
	}
	raw, _ := record["cancelledAt"].(string)
	cancelledAt, ok := parseTimestamp(raw)
	if !ok {
		return KindRejected, Fact{}, ""
	}
	fact.CancelledAt = cancelledAt
	return KindCancelled, fact, ""
}

// DedupeKey is the fact's stable identity inside its type. A published fact
// has no message id: Event Service writes at most one `event.published.v1`
// row per event against the outbox primary key `(event_id, event_type)`, so
// the event id is that fact's stable identity.
func (f Fact) DedupeKey() string {
	if f.MessageID != "" {
		return f.MessageID
	}
	return f.EventID
}

func parseTimestamp(raw string) (time.Time, bool) {
	if raw == "" {
		return time.Time{}, false
	}
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}, false
	}
	return parsed, true
}
