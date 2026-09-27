package unittest

import (
	"strings"
	"testing"

	"github.com/eventa/notification-service/internal/cancellation"
)

func riverlightSummary() cancellation.EventSummary {
	return cancellation.EventSummary{
		EventID:   "2b4b5f8a-9d1e-4a3c-8a6f-1c2d3e4f5a6b",
		StartsAt:  "2026-10-12T18:00:00.000Z",
		TimeZone:  "Europe/Lisbon",
		Title:     "Riverlight Festival",
		VenueCity: "Lisbon",
		VenueName: "Parque das Nações",
	}
}

func TestCancellationEmailDescribesTheStartOfTimeAndVenue(t *testing.T) {
	content, err := cancellation.Render(riverlightSummary())
	if err != nil {
		t.Fatalf("Render error = %v", err)
	}

	if content.Subject != "Riverlight Festival has been cancelled" {
		t.Errorf("subject = %q, want %q", content.Subject, "Riverlight Festival has been cancelled")
	}
	if !strings.Contains(content.Text, "Monday, October 12, 2026 at 7:00 PM GMT+1") {
		t.Errorf("text = %q, want the Lisbon start time", content.Text)
	}
	if !strings.Contains(content.Text, "Parque das Nações, Lisbon") {
		t.Errorf("text = %q, want the venue", content.Text)
	}
	if !strings.Contains(content.Text, "Your tickets for this event are cancelled.") {
		t.Errorf("text = %q, want the meaning line", content.Text)
	}
	if !strings.Contains(content.HTML, "Parque das Nações, Lisbon") {
		t.Errorf("html = %q, want the venue", content.HTML)
	}
}

func TestCancellationEmailOmitsTimeAndVenueWhenTheSummaryHasNeither(t *testing.T) {
	content, err := cancellation.Render(cancellation.EventSummary{
		EventID: "2b4b5f8a-9d1e-4a3c-8a6f-1c2d3e4f5a6b",
		Title:   "Riverlight Festival",
	})
	if err != nil {
		t.Fatalf("Render error = %v", err)
	}

	if strings.Contains(content.Text, "Parque das Nações") {
		t.Errorf("text = %q, want no venue", content.Text)
	}
	if paragraphs := strings.Count(content.HTML, "<p>"); paragraphs != 3 {
		t.Errorf("paragraphs = %d, want 3", paragraphs)
	}
	if lines := nonEmptyLines(content.Text); lines != 4 {
		t.Errorf("non-empty lines = %d, want 4", lines)
	}
}

func TestCancellationEmailEscapesOrganizerTextInTheHtmlBody(t *testing.T) {
	content, err := cancellation.Render(cancellation.EventSummary{
		EventID:   "2b4b5f8a-9d1e-4a3c-8a6f-1c2d3e4f5a6b",
		Title:     "<script>alert(1)</script>",
		VenueCity: "O'Hara",
		VenueName: "Rock & Roll Hall",
	})
	if err != nil {
		t.Fatalf("Render error = %v", err)
	}

	if strings.Contains(content.HTML, "<script>") {
		t.Errorf("html = %q, want the title escaped", content.HTML)
	}
	for _, want := range []string{"&lt;script&gt;", "Rock &amp; Roll Hall", "O&#39;Hara"} {
		if !strings.Contains(content.HTML, want) {
			t.Errorf("html = %q, want %s", content.HTML, want)
		}
	}
	if content.Subject != "<script>alert(1)</script> has been cancelled" {
		t.Errorf("subject = %q, want the raw title", content.Subject)
	}
}

func nonEmptyLines(value string) int {
	count := 0
	for _, line := range strings.Split(value, "\n") {
		if line != "" {
			count++
		}
	}
	return count
}
