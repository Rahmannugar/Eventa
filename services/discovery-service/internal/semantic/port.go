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
	for len(truncated) > 0 && !utf8.ValidString(truncated) {
		truncated = truncated[:len(truncated)-1]
	}
	return truncated
}
