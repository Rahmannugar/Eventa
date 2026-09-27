package cancellation

import "errors"

// Terminal lookup failures. The delivery has no retry that could succeed, so
// these end the email rather than scheduling another attempt.
var (
	ErrAttendeeContactNotFound = errors.New("ATTENDEE_CONTACT_NOT_FOUND")
	ErrEventSummaryNotFound    = errors.New("EVENT_SUMMARY_NOT_FOUND")
)
