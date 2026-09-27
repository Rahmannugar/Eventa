package cancellation

import (
	"encoding/json"
	"regexp"
)

// FactType is the only lifecycle fact this consumer acts on.
const FactType = "ticket.revoked.v1"

// ParseKind classifies one Kafka record the way the TypeScript parser did.
type ParseKind int

const (
	// ParseAccepted means the record is a ticket revocation this service owns.
	ParseAccepted ParseKind = iota
	// ParseForeign means the record is a well-formed fact of another type.
	ParseForeign
	// ParseRejected means the record cannot be read as a fact at all.
	ParseRejected
)

// Fact is a ticket revocation: one issued ticket has been withdrawn.
type Fact struct {
	MessageID  string
	EventID    string
	TicketID   string
	AttendeeID string
	RevokedAt  string
	Type       string
}

// uuidPattern accepts UUID versions 1 to 5 with the RFC 4122 variant, which is
// the exact shape the TypeScript parser required of every identity field.
var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// ParseFact reads a Kafka record value. Unknown keys are ignored and revokedAt
// is only required to be a non-empty string, because the fact is never parsed
// as a timestamp.
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
	if factType != FactType {
		return ParseForeign, Fact{Type: factType}, factType
	}

	fact := Fact{Type: factType}
	identities := map[string]*string{
		"attendeeId": &fact.AttendeeID,
		"eventId":    &fact.EventID,
		"messageId":  &fact.MessageID,
		"ticketId":   &fact.TicketID,
	}
	for field, target := range identities {
		value, ok := record[field].(string)
		if !ok || !uuidPattern.MatchString(value) {
			return ParseRejected, Fact{}, ""
		}
		*target = value
	}

	revokedAt, ok := record["revokedAt"].(string)
	if !ok || revokedAt == "" {
		return ParseRejected, Fact{}, ""
	}
	fact.RevokedAt = revokedAt

	return ParseAccepted, fact, ""
}
