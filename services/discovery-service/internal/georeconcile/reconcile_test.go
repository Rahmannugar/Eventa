package georeconcile

import (
	"testing"
	"time"
)

// TestBackoffDoublesPerAttemptUpToOneHour pins the retry curve: one minute
// for a first failure, doubling, capped at an hour so a dead lookup is
// retried bounded work.
func TestBackoffDoublesPerAttemptUpToOneHour(t *testing.T) {
	cases := []struct {
		attempt int
		want    time.Duration
	}{
		{0, time.Minute},
		{1, 2 * time.Minute},
		{2, 4 * time.Minute},
		{5, 32 * time.Minute},
		{6, time.Hour},
		{7, time.Hour},
		{20, time.Hour},
	}
	for _, c := range cases {
		if got := backoff(c.attempt); got != c.want {
			t.Fatalf("backoff(%d) = %v, want %v", c.attempt, got, c.want)
		}
	}
}
