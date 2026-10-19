package semantic

import (
	"fmt"
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
	first := BuildPreferences([]string{"music", "Jazz"}, nil, nil)
	second := BuildPreferences([]string{"music", "Jazz"}, nil, nil)

	if first != second {
		t.Errorf("preferences differ between renders: %q vs %q", first, second)
	}
	if want := "Interests: music, Jazz"; first != want {
		t.Errorf("BuildPreferences() = %q, want %q", first, want)
	}
}

func TestBuildPreferencesIsEmptyWithoutInterestsOrBehaviour(t *testing.T) {
	if text := BuildPreferences(nil, nil, nil); text != "" {
		t.Errorf("BuildPreferences(nil, nil, nil) = %q, want an empty rendering", text)
	}
}

func TestThePreferenceSharesExactlyTileTheEmbeddingBudget(t *testing.T) {
	if total := attendedShare + purchasedShare + claimedShare; total != maxTextBytes {
		t.Errorf("shares total %d, want the budget %d", total, maxTextBytes)
	}
}

func TestBehaviourOnlyStillRendersNonEmptyPreferences(t *testing.T) {
	text := BuildPreferences(nil, []PreferenceEvent{
		{Title: "Harbour Lights Festival", Categories: []string{"music"}, City: "Bristol"},
	}, nil)
	if text == "" {
		t.Fatal("behaviour without interests rendered an empty preference text")
	}
	if !strings.Contains(text, "Harbour Lights Festival") {
		t.Errorf("text = %q, want the attended event's title", text)
	}
}

func TestAnEventLineCarriesTitleCategoriesAndCity(t *testing.T) {
	text := BuildPreferences(nil, []PreferenceEvent{
		{Title: "Harbour Lights Festival", Categories: []string{"music", "festival"}, City: "Bristol"},
	}, nil)
	if want := "Harbour Lights Festival (music, festival), Bristol"; text != want {
		t.Errorf("text = %q, want %q", text, want)
	}
	if text := BuildPreferences(nil, []PreferenceEvent{{Title: "Jazz Night"}}, nil); text != "Jazz Night" {
		t.Errorf("text = %q, want the bare title when the projection holds nothing else", text)
	}
	if text := BuildPreferences(nil, []PreferenceEvent{{Categories: []string{"music"}}}, nil); text != "" {
		t.Errorf("text = %q, want an empty rendering for an event without a title", text)
	}
}

func TestAttendedEvidencePassesItsUnusedBudgetDownTheWeightOrder(t *testing.T) {
	attended := []PreferenceEvent{{Title: "Jazz Night", Categories: []string{"music"}}}
	purchased := make([]PreferenceEvent, 0, 20)
	for i := 0; i < 20; i++ {
		purchased = append(purchased, PreferenceEvent{
			Title: fmt.Sprintf("Summer Rooftop Cinema Screening %d Under The Stars", i),
		})
	}

	text := BuildPreferences([]string{"music"}, attended, purchased)
	if len(text) > maxTextBytes {
		t.Fatalf("length = %d, want at most %d", len(text), maxTextBytes)
	}
	// One short attended line cannot use its 900-byte share, so purchased must
	// be able to pass 600 bytes: without the cascade it could not fit 20 lines.
	purchasedBytes := 0
	lines := strings.Split(text, "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "Summer Rooftop") {
			purchasedBytes += len(line) + 1
		}
	}
	if purchasedBytes <= purchasedShare {
		t.Errorf("purchased rendered %d bytes, want more than its %d-byte share via the cascade",
			purchasedBytes, purchasedShare)
	}
	if !strings.Contains(text, "Interests: music") {
		t.Errorf("text = %q, want the interests line to keep its claim on the budget", text)
	}
}

func TestAttendedNeverExceedsItsShareEvenWithFloodedEvidence(t *testing.T) {
	flooded := make([]PreferenceEvent, 0, 40)
	for i := 0; i < 40; i++ {
		flooded = append(flooded, PreferenceEvent{
			Title:      fmt.Sprintf("Night %d: An Extremely Long Event Title Filled With Words", i),
			Categories: []string{"music", "nightlife", "festival"},
		})
	}

	text := BuildPreferences(nil, flooded, nil)
	if len(text) > attendedShare {
		t.Errorf("attended tier rendered %d bytes, want at most its %d-byte share", len(text), attendedShare)
	}
}

func TestTheNewestEvidenceIsRenderedFirst(t *testing.T) {
	text := BuildPreferences(nil, []PreferenceEvent{
		{Title: "Newest Event"},
		{Title: "Older Event"},
	}, nil)
	lines := strings.Split(text, "\n")
	if len(lines) != 2 || lines[0] != "Newest Event" || lines[1] != "Older Event" {
		t.Errorf("text = %q, want newest first", text)
	}
}

func TestPreferencesStayWithinTheBudgetUnderPathologicalEvidence(t *testing.T) {
	huge := make([]PreferenceEvent, 0, 60)
	for i := 0; i < 60; i++ {
		huge = append(huge, PreferenceEvent{
			Title:      strings.Repeat("t", 500),
			Categories: []string{strings.Repeat("c", 100)},
			City:       strings.Repeat("y", 100),
		})
	}

	text := BuildPreferences([]string{strings.Repeat("interest", 100)}, huge, huge)
	if len(text) > maxTextBytes {
		t.Fatalf("length = %d, want at most %d", len(text), maxTextBytes)
	}
	if !utf8.ValidString(text) {
		t.Error("preference text is not valid UTF-8")
	}
}

func TestAnInterestsOnlyAttendeeRendersTheFullBudgetLikeBefore(t *testing.T) {
	interests := make([]string, 400)
	for i := range interests {
		interests[i] = "music"
	}
	text := BuildPreferences(interests, nil, nil)
	if len(text) > maxTextBytes {
		t.Fatalf("length = %d, want at most %d", len(text), maxTextBytes)
	}
	if !utf8.ValidString(text) {
		t.Error("preference text is not valid UTF-8")
	}
	// The only difference from the flat rendering may be a trailing space the
	// line writer trims when the budget cut lands on the join separator.
	want := strings.TrimRight(Truncate("Interests: "+strings.Join(interests, ", ")), " ")
	if got := strings.TrimRight(text, " "); got != want {
		t.Errorf("interests-only rendering = %d bytes, want the same content as the flat %d-byte render",
			len(got), len(want))
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
