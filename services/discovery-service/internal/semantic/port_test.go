package semantic

import (
	"strings"
	"testing"
	"unicode/utf8"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestTheSameEventAlwaysRendersTheSameTextAndHash(t *testing.T) {
	first := BuildText("Harbour Lights Festival", "Live music.", []string{"music"}, "North Dock", "Bristol")
	second := BuildText("Harbour Lights Festival", "Live music.", []string{"music"}, "North Dock", "Bristol")

	if first != second {
		t.Errorf("text differs between renders: %q vs %q", first, second)
	}
	if Hash(first) != Hash(second) {
		t.Error("hash differs between renders")
	}
	other := BuildText("Different Night", "Live music.", []string{"music"}, "North Dock", "Bristol")
	if Hash(first) == Hash(other) {
		t.Error("different events share a hash")
	}
}

func TestBuildTextOmitsEmptyParts(t *testing.T) {
	if text := BuildText(" ", "", nil, "", ""); text != "" {
		t.Errorf("text = %q, want an empty rendering", text)
	}
	want := "Title\nDescription\nCategories: music, festival"
	if text := BuildText("Title", "Description", []string{"music", "festival"}, "", ""); text != want {
		t.Errorf("text = %q, want %q", text, want)
	}
}

func TestBuildPreferencesRendersTheSavedInterestsDeterministically(t *testing.T) {
	first := BuildPreferences([]string{"music", "Jazz"})
	second := BuildPreferences([]string{"music", "Jazz"})

	if first != second {
		t.Errorf("preferences differ between renders: %q vs %q", first, second)
	}
	if want := "Interests: music, Jazz"; first != want {
		t.Errorf("BuildPreferences() = %q, want %q", first, want)
	}
}

func TestBuildPreferencesIsEmptyWithoutInterests(t *testing.T) {
	if text := BuildPreferences(nil); text != "" {
		t.Errorf("BuildPreferences(nil) = %q, want an empty rendering", text)
	}
}

func TestTruncateBoundsTextAndKeepsItValidUTF8(t *testing.T) {
	if text := Truncate("short"); text != "short" {
		t.Errorf("Truncate(%q) = %q, want it unchanged", "short", text)
	}

	// A cut that lands inside a rune must not leave bytes the embedding model
	// cannot read.
	long := strings.Repeat("a", maxTextBytes-1) + strings.Repeat("é", 64)
	truncated := Truncate(long)
	if len(truncated) > maxTextBytes {
		t.Errorf("length = %d, want at most %d", len(truncated), maxTextBytes)
	}
	if !utf8.ValidString(truncated) {
		t.Error("truncated text is not valid UTF-8")
	}
	if !strings.HasPrefix(truncated, "aaa") {
		t.Error("truncated text lost its beginning")
	}
}

func TestErrorClassKeepsTransportFailuresBounded(t *testing.T) {
	cases := map[string]error{
		"deadline": status.Error(codes.DeadlineExceeded, "slow"),
		"cancel":   status.Error(codes.Canceled, "stopped"),
		"unusable": status.Error(codes.Unavailable, "down"),
	}
	wants := map[string]string{
		"deadline": "deadline_exceeded",
		"cancel":   "canceled",
		"unusable": "unavailable",
	}
	for name, err := range cases {
		if got := ErrorClass(err); got != wants[name] {
			t.Errorf("%s class = %q, want %q", name, got, wants[name])
		}
	}
	if ErrorClass(nil) != "" {
		t.Error("nil error class is not empty")
	}
}
