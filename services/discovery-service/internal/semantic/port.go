// Package semantic keeps the Discovery-owned event projection searchable. The
// capability is a port: Discovery sends raw text and event identity, and the
// adapter owns vectors, embedding models, and the vector store itself.
package semantic

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"unicode/utf8"
)

// maxTextBytes bounds what one event contributes to an embedding. The default
// model accepts 512 tokens; the cap keeps a long description from being
// silently truncated differently between the index and a rebuild.
const maxTextBytes = 1800

// Attribute is one metadata field Discovery stores beside a vector. The vector
// store is derived state, so nothing here is a source of truth.
type Attribute struct {
	Key   string
	Value string
}

// EventAttributeKey is the metadata field Discovery identifies an event by. It
// is the only predicate Discovery creates or queries.
const EventAttributeKey = "event_id"

// Candidate is one similarity result reduced to what Discovery owns: the event
// identity and the similarity the store scored it with.
type Candidate struct {
	EventID    string
	Similarity float32
}

// Store is the semantic index capability. Implementations own connection
// lifetime, deadlines, retries, and every vendor-specific type; callers pass
// plain text and event ids.
type Store interface {
	// EnsureStore makes the configured store exist with its predicates. It is
	// idempotent and safe to call at startup.
	EnsureStore(ctx context.Context) error
	// IndexEvent replaces whatever the store holds for this event with one
	// entry built from text, so repeating the call converges instead of
	// accumulating duplicates.
	IndexEvent(ctx context.Context, eventID, text string, attributes ...Attribute) error
	// RemoveEvent drops every entry for the event. It succeeds when the store
	// holds nothing for it.
	RemoveEvent(ctx context.Context, eventID string) error
	// Contains reports whether the store still holds an entry for the event.
	Contains(ctx context.Context, eventID string) (bool, error)
	// Search embeds the query and returns the closest events with their
	// similarity.
	Search(ctx context.Context, query string, limit int) ([]Candidate, error)
	// Ping reports whether the store answers at all. It never gates readiness.
	Ping(ctx context.Context) error
	// Close releases the connection during shutdown.
	Close() error
}

// BuildText renders the searchable representation of one event. It is
// deterministic, so the same event always produces the same text and the same
// content hash.
func BuildText(title, description string, categories []string, venueName, venueCity string) string {
	var builder strings.Builder
	writeLine(&builder, title)
	writeLine(&builder, description)
	if len(categories) > 0 {
		writeLine(&builder, "Categories: "+strings.Join(categories, ", "))
	}
	writeLine(&builder, joinNonEmpty(", ", venueName, venueCity))
	return builder.String()
}

// PreferenceEvent is one behavioural row rendered into the preference text.
// Discovery derives nothing the projection does not already hold.
type PreferenceEvent struct {
	Title      string
	Categories []string
	City       string
}

// The query budget is split by evidence strength: what the attendee actually
// attended outweighs what they bought, and both outweigh what they said at
// signup. Each tier is guaranteed its share of the budget; a tier that cannot
// use its guarantee passes the remainder to the next tier in weight order, so
// the whole budget is always spent on the strongest available evidence and an
// interests-only attendee still renders up to the full budget.
const (
	attendedShare  = 900
	purchasedShare = 600
	claimedShare   = 300
)

// BuildPreferences renders the searchable representation of an attendee's
// saved interests and behavioural evidence. It is the query side of
// BuildText: deterministic, bounded by the embedding budget regardless of how
// much evidence exists, and empty only when the attendee has neither
// interests nor behaviour. Evidence arrives newest first and stays that way;
// a mean-pooled embedding is order-invariant, so the weight comes from each
// tier's share of the budget, never from how many rows a tier happens to
// have.
func BuildPreferences(interests []string, attended, purchased []PreferenceEvent) string {
	var builder strings.Builder
	remaining := maxTextBytes

	spent := writeEvents(&builder, attended, attendedShare, remaining)
	remaining -= spent
	carry := attendedShare - spent

	spent = writeEvents(&builder, purchased, purchasedShare+carry, remaining)
	remaining -= spent
	carry = purchasedShare + carry - spent

	writeInterests(&builder, interests, claimedShare+carry, remaining)
	return builder.String()
}

// writeEvents renders one tier's events while they fit both the tier's
// allowance and what is left of the budget, and reports the bytes it used
// including separators. A line that does not fit ends the tier: partial words
// would pollute the embedding, and stopping keeps the renderer deterministic.
func writeEvents(builder *strings.Builder, events []PreferenceEvent, allowance, remaining int) int {
	budget := allowance
	if remaining < budget {
		budget = remaining
	}
	used := 0
	for _, event := range events {
		line := renderPreferenceEvent(event)
		if line == "" {
			continue
		}
		cost := len(line)
		if builder.Len() > 0 {
			cost++
		}
		if used+cost > budget {
			break
		}
		writeLine(builder, line)
		used += cost
	}
	return used
}

// writeInterests renders the claimed-interests line inside its allowance. The
// line is cut to fit rather than dropped: interests are the attendee's own
// statement and must appear even when stronger evidence used most of the
// budget.
func writeInterests(builder *strings.Builder, interests []string, allowance, remaining int) {
	if len(interests) == 0 {
		return
	}
	budget := allowance
	if remaining < budget {
		budget = remaining
	}
	if builder.Len() > 0 {
		budget--
	}
	if budget <= 0 {
		return
	}
	writeLine(builder, truncateLine("Interests: "+strings.Join(interests, ", "), budget))
}

// renderPreferenceEvent is one behaviour event as one preference line: its
// title, its categories when the projection holds them, and its city when the
// venue knows it. An event without a title is never rendered.
func renderPreferenceEvent(event PreferenceEvent) string {
	title := strings.TrimSpace(event.Title)
	if title == "" {
		return ""
	}
	line := title
	if len(event.Categories) > 0 {
		line += " (" + strings.Join(event.Categories, ", ") + ")"
	}
	return joinNonEmpty(", ", line, event.City)
}

// truncateLine cuts a line to a byte budget without leaving a partial rune.
func truncateLine(line string, budget int) string {
	if len(line) <= budget {
		return line
	}
	return runeSafeCut(line[:budget])
}

// joinNonEmpty keeps a rendering free of separators for parts the projection
// does not know.
func joinNonEmpty(separator string, parts ...string) string {
	kept := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			kept = append(kept, trimmed)
		}
	}
	return strings.Join(kept, separator)
}

func writeLine(builder *strings.Builder, line string) {
	line = strings.TrimSpace(line)
	if line == "" {
		return
	}
	if builder.Len() > 0 {
		builder.WriteByte('\n')
	}
	builder.WriteString(line)
}

// Hash returns the stable content hash of a rendered text. A changed hash means
// the stored text no longer matches what Discovery would push today.
func Hash(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}

// Truncate bounds a rendered text without leaving a partial rune behind.
func Truncate(text string) string {
	if len(text) <= maxTextBytes {
		return text
	}
	truncated := text[:maxTextBytes]
	if index := strings.LastIndexByte(truncated, '\n'); index > maxTextBytes/2 {
		truncated = truncated[:index]
	}
	return runeSafeCut(truncated)
}

// runeSafeCut drops the bytes of an incomplete trailing rune after a cut.
func runeSafeCut(text string) string {
	for len(text) > 0 && !utf8.ValidString(text) {
		text = text[:len(text)-1]
	}
	return text
}
