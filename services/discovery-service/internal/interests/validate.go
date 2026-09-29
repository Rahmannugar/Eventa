package interests

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// Bounds an attendee can put on their own preference list. They exist so one
// request cannot make Discovery store an unbounded document for one attendee,
// not to describe what a good interest is.
const (
	// MaxInterests is the largest number of interests one request may submit
	// and the largest number one attendee may store.
	MaxInterests = 50
	// MaxInterestLength bounds one interest after trimming.
	MaxInterestLength = 64
)

// normalize trims each submitted interest, drops the empty ones, and removes
// duplicates case-insensitively while keeping the first spelling, so "Music"
// and "music" are one stored interest rather than two competing signals. It
// reports an error for anything out of bounds instead of silently shortening
// a request, so a caller is never told it stored more than it did.
func normalize(values []string) ([]string, error) {
	if len(values) > MaxInterests {
		return nil, fmt.Errorf("at most %d interests", MaxInterests)
	}

	normalized := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if !utf8.ValidString(trimmed) {
			return nil, fmt.Errorf("interest is not valid UTF-8")
		}
		if utf8.RuneCountInString(trimmed) > MaxInterestLength {
			return nil, fmt.Errorf("interest is longer than %d characters", MaxInterestLength)
		}
		key := strings.ToLower(trimmed)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		normalized = append(normalized, trimmed)
	}

	return normalized, nil
}
