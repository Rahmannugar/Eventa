// Package eventseed generates published events and bulk-inserts them, with
// their ticket inventory and their publication outbox rows, straight into the
// Event Service database. The rows are shaped exactly as Event Service's own
// publish flow writes them, so Debezium relays them onto
// `eventa.event.lifecycle.v1` and every other service learns about them
// through the pipeline it already trusts.
package eventseed

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"strings"
	"time"

	"github.com/google/uuid"
)

// The constants below mirror what Event Service writes when an organizer
// publishes an event, so a seeded row and a hand-published row are
// indistinguishable to every consumer.
const (
	// PublishedStatus is the only status a seeded event carries.
	PublishedStatus = "published"
	// LifecycleAggregateType is the outbox aggregate Debezium routes to the
	// `eventa.event.lifecycle.v1` topic.
	LifecycleAggregateType = "eventa.event.lifecycle.v1"
	// PublishedEventType is the only fact type seeded events emit.
	PublishedEventType = "event.published.v1"
	// PublishedVersion mirrors a real publish: a draft starts at version 1 and
	// publishing bumps it, so the row and its fact both carry version 2.
	PublishedVersion = 2
	// Currency is the single ticket currency seeded events define.
	Currency = "NGN"
)

// Venue is the one venue row an event carries.
type Venue struct {
	Name         string
	AddressLine1 string
	City         string
	CountryCode  string
}

// TicketType is one sellable ticket currency beneath the event's currency.
type TicketType struct {
	ID          uuid.UUID
	Name        string
	Description string
	PriceMinor  int64
	Capacity    int
	SalesStart  time.Time
	SalesEnd    time.Time
}

// Event is everything one seeded event writes across the six Event Service
// tables it owns.
type Event struct {
	ID          uuid.UUID
	Title       string
	Description string
	AdminID     uuid.UUID
	StartsAt    time.Time
	EndsAt      time.Time
	TimeZone    string
	PublishedAt time.Time
	Categories  []string
	Venue       Venue
	CurrencyID  uuid.UUID
	TicketTypes []TicketType
}

// PublishedPayload is the `event.published.v1` outbox payload, field for field
// the shape Event Service's publish flow writes and Discovery's lifecycle
// consumer validates.
type PublishedPayload struct {
	EventID     string `json:"eventId"`
	PublishedAt string `json:"publishedAt"`
	Type        string `json:"type"`
	Version     int    `json:"version"`
}

// Payload returns the outbox payload this event's publication row carries.
func (e Event) Payload() PublishedPayload {
	return PublishedPayload{
		EventID:     e.ID.String(),
		PublishedAt: e.PublishedAt.Format(time.RFC3339),
		Type:        PublishedEventType,
		Version:     PublishedVersion,
	}
}

// PayloadJSON returns the payload as the JSON bytes the outbox column stores.
func (e Event) PayloadJSON() []byte {
	encoded, err := json.Marshal(e.Payload())
	if err != nil {
		panic(fmt.Sprintf("eventseed: payload is always marshalable: %v", err))
	}
	return encoded
}

type city struct {
	Name        string
	CountryCode string
}

// The word lists below keep the corpus varied enough that search,
// recommendations, and similar events have something to rank. Every pick is
// derived from the seed and the generator index, never from wall-clock state,
// so a range always generates the same rows.
var (
	cities = []city{
		{"Lagos", "NG"}, {"Abuja", "NG"}, {"Ibadan", "NG"}, {"Accra", "GH"},
		{"Kumasi", "GH"}, {"Nairobi", "KE"}, {"Kigali", "RW"}, {"Dar es Salaam", "TZ"},
	}
	adjectives = []string{
		"Annual", "Sunset", "Rooftop", "Indie", "Urban", "Coastal", "Twilight",
		"Underground", "Artisan", "Skyline", "Mainland", "Emerald", "Golden",
		"Neon", "Heritage", "Modern", "Island", "Riverside", "Garden", "Midtown",
	}
	nouns = []string{
		"Jollof Festival", "Tech Meetup", "Art Fair", "Film Night", "Comedy Show",
		"Music Concert", "Food Market", "Design Workshop", "Startup Demo Day",
		"Poetry Slam", "Marathon Expo", "Photography Walk", "Book Fair",
		"Dance Battle", "Founders Breakfast", "Fashion Show", "Hackathon",
		"Storytelling Night", "Wine Tasting", "Community Forum",
	}
	formats = []string{"Live", "Edition", "Series", "Showcase", "Session", "Weekend"}
	topics  = []string{
		"live music", "talks from local builders", "independent food vendors",
		"screenings and Q and A", "hands on making", "competition rounds",
		"panel conversations", "open air performance", "workshops for beginners",
		"showcased collections",
	}
	venueKinds = []string{
		"Convention Centre", "Civic Hall", "Exhibition Grounds", "Riverside Pavilion",
		"Arts Centre", "Conference Hub",
	}
	streets = []string{
		"Awolowo Road", "Herbert Macaulay Way", "Ozumba Mbadiwe Avenue",
		"Kwame Nkrumah Avenue", "Chiromo Road", "Ring Road", "Independence Road",
		"Marina Street",
	}
	timeZones = []string{
		"Africa/Lagos", "Africa/Accra", "Africa/Nairobi", "Africa/Kigali",
		"Africa/Dar_es_Salaam",
	}
	CategoryPool = []string{
		"Music", "Tech", "Food & Drink", "Art", "Film", "Sports", "Business",
		"Comedy", "Fashion", "Literature", "Community", "Nightlife", "Wellness",
		"Education",
	}
	ticketNames = []string{
		"General admission", "Early bird", "VIP", "Table for four",
		"Student entry", "Group of five",
	}
)

// InterestPool is the vocabulary attendee interests are drawn from: the
// categories seeded events carry plus the themes their titles are built from,
// so a seeded preference can match seeded content instead of pointing at
// nothing.
var InterestPool = append(append(make([]string, 0, len(CategoryPool)+len(nouns)), CategoryPool...), nouns...)

// Generate returns the event for one generator index. The same seed, index,
// instant, and admin always produce the same event, which is what makes
// rerunning a range a no-op instead of a duplicate.
func Generate(seed int64, index int, now time.Time, adminID uuid.UUID) Event {
	h := sha256.Sum256([]byte(fmt.Sprintf("eventa/seeder/v1/%d/%d", seed, index)))
	rng := rand.New(rand.NewPCG(
		binary.LittleEndian.Uint64(h[0:8]),
		binary.LittleEndian.Uint64(h[8:16]),
	))

	home := cities[rng.IntN(len(cities))]
	noun := nouns[rng.IntN(len(nouns))]
	adjective := adjectives[rng.IntN(len(adjectives))]
	format := formats[rng.IntN(len(formats))]

	var title string
	switch rng.IntN(3) {
	case 0:
		title = fmt.Sprintf("%s %s: %s", home.Name, noun, format)
	case 1:
		title = fmt.Sprintf("%s %s %s", adjective, noun, format)
	default:
		title = fmt.Sprintf("%s %s in %s", adjective, noun, home.Name)
	}

	startsAt := generatedStart(now, rng.IntN(280)+7, rng.IntN(8)+10)
	endsAt := startsAt.Add(time.Duration(rng.IntN(6)+2) * time.Hour)

	return Event{
		ID:    deriveID(seed, index, "event"),
		Title: title,
		Description: strings.TrimSpace(fmt.Sprintf(
			"A %s %s in %s built around %s, with the main programme running across %d hours. Doors open two hours before the first session.",
			strings.ToLower(adjective), strings.ToLower(noun), home.Name,
			topics[rng.IntN(len(topics))], int(endsAt.Sub(startsAt).Hours()),
		)),
		AdminID:     adminID,
		StartsAt:    startsAt,
		EndsAt:      endsAt,
		TimeZone:    timeZones[rng.IntN(len(timeZones))],
		PublishedAt: now.UTC(),
		Categories:  pickCategories(rng),
		Venue: Venue{
			Name:         fmt.Sprintf("%s %s", home.Name, venueKinds[rng.IntN(len(venueKinds))]),
			AddressLine1: fmt.Sprintf("%d %s", rng.IntN(400)+1, streets[rng.IntN(len(streets))]),
			City:         home.Name,
			CountryCode:  home.CountryCode,
		},
		CurrencyID:  deriveID(seed, index, "currency"),
		TicketTypes: ticketTypes(seed, index, now, startsAt, rng),
	}
}

// generatedStart places a future start at a fixed hour so a seeded event is
// always upcoming: recommendations only offer events that start after now.
func generatedStart(now time.Time, daysAhead, hour int) time.Time {
	day := now.UTC().AddDate(0, 0, daysAhead)
	return time.Date(day.Year(), day.Month(), day.Day(), hour, 0, 0, 0, time.UTC)
}

// ticketTypes builds 1 to 3 distinct, priced, capped ticket currencies whose
// sales window is open right now, so authority queries keep the event.
func ticketTypes(seed int64, index int, now, startsAt time.Time, rng *rand.Rand) []TicketType {
	count := rng.IntN(3) + 1
	start := rng.IntN(len(ticketNames) - count + 1)
	names := ticketNames[start : start+count]
	salesStart := now.UTC().AddDate(0, 0, -14)

	types := make([]TicketType, 0, count)
	for i, name := range names {
		base := int64(250_000 + rng.IntN(98)*25_000)
		capacity := 50 + rng.IntN(951)
		if i > 0 {
			base += int64(i) * 250_000
			capacity = 10 + capacity/(i+1)
		}
		types = append(types, TicketType{
			ID:          deriveID(seed, index, fmt.Sprintf("ticket/%d", i)),
			Name:        name,
			Description: fmt.Sprintf("%s entry to the event.", strings.ToLower(name)),
			PriceMinor:  base,
			Capacity:    capacity,
			SalesStart:  salesStart,
			SalesEnd:    startsAt,
		})
	}
	return types
}

func pickCategories(rng *rand.Rand) []string {
	count := rng.IntN(3) + 1
	chosen := make([]string, 0, count)
	seen := make(map[string]struct{}, count)
	for len(chosen) < count {
		candidate := CategoryPool[rng.IntN(len(CategoryPool))]
		if _, exists := seen[candidate]; exists {
			continue
		}
		seen[candidate] = struct{}{}
		chosen = append(chosen, candidate)
	}
	return chosen
}

// deriveID is a stable, version-5 shaped UUID for one generated row. It
// depends only on the seed, the index, and the label, never on the run, so
// every rerun of a range addresses the same rows and the insert is a no-op.
func deriveID(seed int64, index int, label string) uuid.UUID {
	sum := sha256.Sum256([]byte(fmt.Sprintf("eventa/seeder/v1/%d/%d/%s", seed, index, label)))
	var id uuid.UUID
	copy(id[:], sum[:16])
	id[6] = (id[6] & 0x0f) | 0x50
	id[8] = (id[8] & 0x3f) | 0x80
	return id
}
