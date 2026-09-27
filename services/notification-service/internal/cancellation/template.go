package cancellation

import (
	"fmt"
	"strings"
	"time"

	// The runtime image carries no zone database, so the binary embeds one.
	// A cancellation email must resolve the event's zone on every host.
	_ "time/tzdata"
)

// EventSummary is the resolved event content the email renders. StartsAt and
// TimeZone are optional; venue fields are only meaningful when the event
// carried a venue at all.
type EventSummary struct {
	EventID   string
	Title     string
	StartsAt  string
	TimeZone  string
	VenueName string
	VenueCity string
}

// Content is the rendered email.
type Content struct {
	Subject string
	Text    string
	HTML    string
}

// usShortZones are the zone abbreviations ICU keeps for the en-US locale.
// Everywhere else it renders a numeric GMT offset, so a zone Go abbreviates as
// CEST or JST must be rendered as GMT+2 or GMT+9 to match the original email.
var usShortZones = map[string]bool{
	"EST": true, "EDT": true, "CST": true, "CDT": true,
	"MST": true, "MDT": true, "PST": true, "PDT": true,
	"AKST": true, "AKDT": true, "HST": true,
	"AST": true, "ADT": true, "NST": true, "NDT": true,
}

// Render builds the cancellation email. A time zone the host cannot resolve is
// an error rather than a silent fallback, so it surfaces as a retryable
// provider failure exactly as it did before.
func Render(summary EventSummary) (Content, error) {
	opening := fmt.Sprintf("We're sorry to let you know that %s has been cancelled.", summary.Title)

	when, err := formatStartsAt(summary.StartsAt, summary.TimeZone)
	if err != nil {
		return Content{}, err
	}
	place := formatVenue(summary.VenueName, summary.VenueCity)

	const meaning = "Your tickets for this event are cancelled."
	const nextStep = "There is nothing you need to do."

	textLines := []string{opening}
	if when != "" {
		textLines = append(textLines, "", when)
	}
	if place != "" {
		textLines = append(textLines, "", place)
	}
	textLines = append(textLines, "", meaning, nextStep, "", "Eventa")

	var html strings.Builder
	html.WriteString("<p>" + escapeHTML(opening) + "</p>")
	if when != "" {
		html.WriteString("<p>" + escapeHTML(when) + "</p>")
	}
	if place != "" {
		html.WriteString("<p>" + escapeHTML(place) + "</p>")
	}
	html.WriteString("<p>" + escapeHTML(meaning) + " " + escapeHTML(nextStep) + "</p>")
	html.WriteString("<p>Eventa</p>")

	return Content{
		Subject: summary.Title + " has been cancelled",
		Text:    strings.Join(textLines, "\n"),
		HTML:    html.String(),
	}, nil
}

// formatStartsAt renders `weekday, month day, year at h:mm AM/PM` in the
// event's zone, suffixed with the zone name only when the event names one. An
// empty startsAt or an unparseable one omits the line entirely.
func formatStartsAt(startsAt, timeZone string) (string, error) {
	if startsAt == "" {
		return "", nil
	}
	parsed, err := time.Parse(time.RFC3339Nano, startsAt)
	if err != nil {
		return "", nil
	}

	location := time.Local
	zoneSuffix := ""
	if timeZone != "" {
		zone, err := time.LoadLocation(timeZone)
		if err != nil {
			return "", fmt.Errorf("load event time zone: %w", err)
		}
		location = zone
		zoneSuffix = " " + shortZoneName(parsed.In(zone))
	}

	local := parsed.In(location)
	hour := local.Hour()
	meridiem := "AM"
	if hour >= 12 {
		meridiem = "PM"
	}
	twelveHour := hour % 12
	if twelveHour == 0 {
		twelveHour = 12
	}

	return fmt.Sprintf("%s, %s %d, %d at %d:%02d %s%s",
		local.Format("Monday"),
		local.Format("January"),
		local.Day(),
		local.Year(),
		twelveHour,
		local.Minute(),
		meridiem,
		zoneSuffix,
	), nil
}

// shortZoneName renders the suffix the way ICU's en-US `short` style does.
func shortZoneName(t time.Time) string {
	name, offset := t.Zone()
	if offset == 0 && (name == "UTC" || name == "GMT") {
		return name
	}
	if usShortZones[name] {
		return name
	}

	sign := "+"
	if offset < 0 {
		sign = "-"
		offset = -offset
	}
	hours := offset / 3600
	minutes := (offset % 3600) / 60
	if minutes == 0 {
		return fmt.Sprintf("GMT%s%d", sign, hours)
	}
	return fmt.Sprintf("GMT%s%d:%02d", sign, hours, minutes)
}

// formatVenue joins the venue name and city, dropping empty parts.
func formatVenue(name, city string) string {
	parts := make([]string, 0, 2)
	for _, part := range []string{name, city} {
		if part != "" {
			parts = append(parts, part)
		}
	}
	return strings.Join(parts, ", ")
}

func escapeHTML(value string) string {
	replacer := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&#39;",
	)
	return replacer.Replace(value)
}
