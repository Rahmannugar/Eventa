package index

import "time"

// Content is the authoritative event content Discovery copies out of Event
// Service. Discovery never derives it and never reads Event's database.
type Content struct {
	Title            string
	Description      string
	StartsAt         time.Time
	EndsAt           time.Time
	TimeZone         string
	Categories       []string
	VenueName        string
	VenueCity        string
	VenueCountryCode string
	VenueLatitude    *float64
	VenueLongitude   *float64
}

// optionalTime yields a pointer Postgres can store as a nullable timestamp.
func optionalTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value
}

func optionalText(value string) any {
	if value == "" {
		return nil
	}
	return value
}

// optionalCoordinate stores a venue coordinate as the nullable value Postgres
// keeps; nil means the venue carries no location.
func optionalCoordinate(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}

func categoryList(content *Content) []string {
	if content == nil || len(content.Categories) == 0 {
		return []string{}
	}
	return content.Categories
}
