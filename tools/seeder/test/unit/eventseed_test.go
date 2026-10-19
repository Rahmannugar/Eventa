package unittest

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/eventa/tools/seeder/internal/eventseed"
)

var (
	titleRule     = regexp.MustCompile(`^.{1,160}$`)
	countryRule   = regexp.MustCompile(`^[A-Z]{2}$`)
	ticketNameRl  = regexp.MustCompile(`^[^ ].{0,78}[^ ]$|^[^ ]$`)
	doubleSpaceRl = regexp.MustCompile(`\s{2,}`)
)

const sampleCount = 400

func sampleEvents(t *testing.T, now time.Time, adminID uuid.UUID) []eventseed.Event {
	t.Helper()
	events := make([]eventseed.Event, 0, sampleCount)
	for index := range sampleCount {
		events = append(events, eventseed.Generate(20261019, index, now, adminID))
	}
	return events
}

// TestTheSameSeedAndRangeAlwaysGenerateTheSameRows is what makes a rerun a
// no-op: ids and content must depend on the seed and index alone, never on the
// clock or on the previous run.
func TestTheSameSeedAndRangeAlwaysGenerateTheSameRows(t *testing.T) {
	admin := uuid.MustParse("0d0f7d2e-0000-4000-8000-000000000001")
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	later := now.Add(6 * time.Hour)

	first := sampleEvents(t, now, admin)
	second := sampleEvents(t, later, admin)

	for index := range first {
		if first[index].ID != second[index].ID {
			t.Fatalf("event %d changed id between runs: %s != %s", index, first[index].ID, second[index].ID)
		}
		if first[index].Title != second[index].Title {
			t.Fatalf("event %d changed content between runs", index)
		}
		if first[index].CurrencyID != second[index].CurrencyID {
			t.Fatalf("event %d changed currency id between runs", index)
		}
		for ticketIndex, ticketType := range first[index].TicketTypes {
			if ticketType.ID != second[index].TicketTypes[ticketIndex].ID {
				t.Fatalf("event %d ticket %d changed id between runs", index, ticketIndex)
			}
		}
	}

	if first[0].ID == first[1].ID {
		t.Fatal("two indices produced the same event id")
	}
	if first[0].ID == first[0].CurrencyID {
		t.Fatal("an event and its currency shared an id")
	}
}

// TestGeneratedEventsSatisfyTheEventSchemaRules keeps every generated row
// inside the constraints the Event Service schema enforces, so a seed run
// never dies halfway through on a title, a sales window, or a country code.
func TestGeneratedEventsSatisfyTheEventSchemaRules(t *testing.T) {
	admin := uuid.MustParse("0d0f7d2e-0000-4000-8000-000000000001")
	now := time.Now().UTC().Truncate(time.Second)

	for _, event := range sampleEvents(t, now, admin) {
		if !titleRule.MatchString(event.Title) || event.Title != strings.TrimSpace(event.Title) {
			t.Fatalf("event %q: title must be trimmed and 1-160 characters", event.Title)
		}
		if event.Description == "" || event.Description != strings.TrimSpace(event.Description) || len(event.Description) > 10000 {
			t.Fatalf("event %q: description must be trimmed and 1-10000 characters", event.Title)
		}
		if event.StartsAt.After(event.EndsAt) || event.StartsAt.Equal(event.EndsAt) {
			t.Fatalf("event %q: ends_at must be after starts_at", event.Title)
		}
		if !event.StartsAt.After(now) {
			t.Fatalf("event %q: starts_at %s must be in the future", event.Title, event.StartsAt)
		}
		if len(event.TimeZone) < 1 || len(event.TimeZone) > 64 {
			t.Fatalf("event %q: time zone out of range", event.Title)
		}
		if len(event.Categories) < 1 || len(event.Categories) > 3 {
			t.Fatalf("event %q: needs 1-3 categories", event.Title)
		}
		seen := map[string]struct{}{}
		for _, category := range event.Categories {
			if category != strings.TrimSpace(category) || len(category) > 80 {
				t.Fatalf("event %q: category %q out of range", event.Title, category)
			}
			if _, duplicate := seen[category]; duplicate {
				t.Fatalf("event %q: duplicate category %q", event.Title, category)
			}
			seen[category] = struct{}{}
		}

		if !titleRule.MatchString(event.Venue.Name) || event.Venue.Name != strings.TrimSpace(event.Venue.Name) {
			t.Fatalf("event %q: venue name out of range", event.Title)
		}
		if event.Venue.AddressLine1 == "" || event.Venue.AddressLine1 != strings.TrimSpace(event.Venue.AddressLine1) || len(event.Venue.AddressLine1) > 200 {
			t.Fatalf("event %q: venue address out of range", event.Title)
		}
		if event.Venue.City == "" || event.Venue.City != strings.TrimSpace(event.Venue.City) || len(event.Venue.City) > 120 {
			t.Fatalf("event %q: venue city out of range", event.Title)
		}
		if !countryRule.MatchString(event.Venue.CountryCode) {
			t.Fatalf("event %q: country code %q must be two uppercase letters", event.Title, event.Venue.CountryCode)
		}

		if len(event.TicketTypes) < 1 || len(event.TicketTypes) > 3 {
			t.Fatalf("event %q: needs 1-3 ticket types", event.Title)
		}
		names := map[string]struct{}{}
		for _, ticketType := range event.TicketTypes {
			if !ticketNameRl.MatchString(ticketType.Name) || len(ticketType.Name) > 80 {
				t.Fatalf("event %q: ticket name %q out of range", event.Title, ticketType.Name)
			}
			if doubleSpaceRl.MatchString(ticketType.Name) {
				t.Fatalf("event %q: ticket name %q contains consecutive spaces", event.Title, ticketType.Name)
			}
			key := strings.ToLower(ticketType.Name)
			if _, duplicate := names[key]; duplicate {
				t.Fatalf("event %q: duplicate ticket name %q", event.Title, ticketType.Name)
			}
			names[key] = struct{}{}

			if ticketType.PriceMinor < 0 || ticketType.PriceMinor > 2147483647 {
				t.Fatalf("event %q: price %d out of the integer range", event.Title, ticketType.PriceMinor)
			}
			if ticketType.Capacity < 1 || ticketType.Capacity > 1000000 {
				t.Fatalf("event %q: capacity %d out of range", event.Title, ticketType.Capacity)
			}
			if !ticketType.SalesEnd.After(ticketType.SalesStart) {
				t.Fatalf("event %q: sales window must end after it opens", event.Title)
			}
			if !ticketType.SalesEnd.After(now) {
				t.Fatalf("event %q: sales window must still be open at %s", event.Title, now)
			}
			if ticketType.SalesStart.After(now) {
				t.Fatalf("event %q: sales window must already be open at %s", event.Title, now)
			}
			if !ticketType.SalesEnd.Equal(event.StartsAt) {
				t.Fatalf("event %q: sales must close at the event start", event.Title)
			}
		}
	}
}

// TestPublishedPayloadMatchesTheLifecycleContract pins the outbox payload to
// the shape Discovery's lifecycle consumer validates: a mismatch would make
// every seeded fact a contract violation that never advances its offset.
func TestPublishedPayloadMatchesTheLifecycleContract(t *testing.T) {
	admin := uuid.MustParse("0d0f7d2e-0000-4000-8000-000000000001")
	now := time.Now().UTC().Truncate(time.Second)

	for _, event := range sampleEvents(t, now, admin) {
		encoded := event.PayloadJSON()
		var fields map[string]any
		if err := json.Unmarshal(encoded, &fields); err != nil {
			t.Fatalf("event %q: payload is not JSON: %v", event.Title, err)
		}
		if len(fields) != 4 {
			t.Fatalf("event %q: payload must carry exactly eventId, publishedAt, type, version; got %v", event.Title, fields)
		}

		payload := event.Payload()
		if payload.Type != eventseed.PublishedEventType {
			t.Fatalf("event %q: payload type %q", event.Title, payload.Type)
		}
		if payload.EventID != event.ID.String() {
			t.Fatalf("event %q: payload eventId %q does not match the row id %s", event.Title, payload.EventID, event.ID)
		}
		publishedAt, err := time.Parse(time.RFC3339, payload.PublishedAt)
		if err != nil {
			t.Fatalf("event %q: payload publishedAt %q is not RFC 3339: %v", event.Title, payload.PublishedAt, err)
		}
		if !publishedAt.Equal(event.PublishedAt) {
			t.Fatalf("event %q: payload publishedAt %s does not match the row %s", event.Title, publishedAt, event.PublishedAt)
		}
		if payload.Version != eventseed.PublishedVersion {
			t.Fatalf("event %q: payload version %d", event.Title, payload.Version)
		}
	}
}

// TestEveryEventCarriesSellableInventory protects the rule that makes seeded
// events visible at all: authority queries drop events without a live,
// affordable, in-stock ticket type.
func TestEveryEventCarriesSellableInventory(t *testing.T) {
	admin := uuid.MustParse("0d0f7d2e-0000-4000-8000-000000000001")
	now := time.Now().UTC().Truncate(time.Second)

	for _, event := range sampleEvents(t, now, admin) {
		sellable := false
		for _, ticketType := range event.TicketTypes {
			if ticketType.Capacity > 0 && ticketType.SalesEnd.After(now) {
				sellable = true
			}
		}
		if !sellable {
			t.Fatalf("event %q has no sellable ticket type", event.Title)
		}
		if event.PublishedAt.IsZero() || event.AdminID != admin {
			t.Fatalf("event %q is missing its publish timestamp or owning admin", event.Title)
		}
	}
}
