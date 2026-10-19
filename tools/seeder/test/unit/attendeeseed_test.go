package unittest

import (
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/eventa/tools/seeder/internal/attendeeseed"
	"github.com/eventa/tools/seeder/internal/eventseed"
)

const (
	seedPassword = "EventaDev!2026"
	seedSample   = 10
)

var (
	emailRule   = regexp.MustCompile(`^[a-z]+(\.[a-z]+)@eventa\.com$`)
	usernameRl  = regexp.MustCompile(`^[a-z0-9_]{3,30}$`)
	phcPrefixRl = regexp.MustCompile(`^\$argon2id\$v=19\$m=65536,t=3,p=4\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$`)
)

// TestOneIndexAlwaysMapsToOneName protects the unique indexes the account
// insert depends on: every addressable index must own its own email and
// username, including the whole name space a single range can walk.
func TestOneIndexAlwaysMapsToOneName(t *testing.T) {
	if attendeeseed.MaxRange < 100 {
		t.Fatalf("the name space covers %d attendees, less than the 100 the dataset needs", attendeeseed.MaxRange)
	}

	emails := make(map[string]int, attendeeseed.MaxRange)
	usernames := make(map[string]int, attendeeseed.MaxRange)
	for index := 0; index < attendeeseed.MaxRange; index++ {
		email, username := attendeeseed.Name(index)
		if !emailRule.MatchString(email) {
			t.Fatalf("index %d produced email %q", index, email)
		}
		if !usernameRl.MatchString(username) {
			t.Fatalf("index %d produced username %q", index, username)
		}
		if previous, taken := emails[email]; taken {
			t.Fatalf("indexes %d and %d share the email %s", previous, index, email)
		}
		if previous, taken := usernames[username]; taken {
			t.Fatalf("indexes %d and %d share the username %s", previous, index, username)
		}
		emails[email] = index
		usernames[username] = index
	}
}

// TestTheSameSeedAndRangeAlwaysGenerateTheSameAttendee is what makes a rerun
// a no-op: ids, credentials, and interests must depend on the seed and index
// alone, never on the clock.
func TestTheSameSeedAndRangeAlwaysGenerateTheSameAttendee(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	first := attendeeseed.Generate(20261019, 7, now, seedPassword)
	second := attendeeseed.Generate(20261019, 7, now.Add(6*time.Hour), seedPassword)

	if first.ID != second.ID || first.Email != second.Email || first.Username != second.Username {
		t.Fatal("the same seed and index produced different accounts")
	}
	if first.PasswordHash != second.PasswordHash {
		t.Fatal("the same seed and index produced different credentials")
	}
	if strings.Join(first.Interests, "|") != strings.Join(second.Interests, "|") {
		t.Fatal("the same seed and index produced different interests")
	}

	other := attendeeseed.Generate(20261019, 8, now, seedPassword)
	if other.ID == first.ID || other.Email == first.Email {
		t.Fatal("two indexes produced the same account")
	}

	differentSeed := attendeeseed.Generate(20261020, 7, now, seedPassword)
	if differentSeed.ID == first.ID {
		t.Fatal("two seeds produced the same account id")
	}
	if differentSeed.PasswordHash == first.PasswordHash {
		t.Fatal("two seeds produced the same credential")
	}
}

// TestGeneratedAttendeesAreLoginReady checks every rule Identity applies
// before it issues a session, so a seeded account logs in on the first try:
// canonical fields, a verified active account, and a credential that verifies.
func TestGeneratedAttendeesAreLoginReady(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	seen := map[string]struct{}{}

	for index := range seedSample {
		attendee := attendeeseed.Generate(20261019, index, now, seedPassword)

		if !emailRule.MatchString(attendee.Email) || attendee.Email != strings.ToLower(attendee.Email) {
			t.Fatalf("attendee %d has a non-canonical email %q", index, attendee.Email)
		}
		if len(attendee.Email) > 320 {
			t.Fatalf("attendee %d email exceeds the login bound", index)
		}
		if !usernameRl.MatchString(attendee.Username) {
			t.Fatalf("attendee %d username %q breaks the account rule", index, attendee.Username)
		}
		if _, taken := seen[attendee.Email]; taken {
			t.Fatalf("attendee %d repeats the email %s", index, attendee.Email)
		}
		seen[attendee.Email] = struct{}{}

		if attendee.EmailVerifiedAt.IsZero() {
			t.Fatalf("attendee %d must be verified, or login is refused", index)
		}
		if !phcPrefixRl.MatchString(attendee.PasswordHash) {
			t.Fatalf("attendee %d hash %q is not the argon2id shape Identity verifies", index, attendee.PasswordHash)
		}
		if !attendeeseed.VerifyPassword(attendee.PasswordHash, seedPassword) {
			t.Fatalf("attendee %d cannot log in with the shared password", index)
		}
		if attendeeseed.VerifyPassword(attendee.PasswordHash, seedPassword+"x") {
			t.Fatalf("attendee %d accepts a wrong password", index)
		}
	}
}

// TestInterestsDrawFromSeededContentVocabulary keeps seeded preferences
// inside the bounds Discovery enforces and inside the words the seeded events
// are built from, so recommendations have something to match.
func TestInterestsDrawFromSeededContentVocabulary(t *testing.T) {
	now := time.Now().UTC()
	known := make(map[string]struct{}, len(eventseed.InterestPool))
	for _, interest := range eventseed.InterestPool {
		known[interest] = struct{}{}
	}

	for index := range seedSample {
		attendee := attendeeseed.Generate(20261019, index, now, seedPassword)
		if len(attendee.Interests) < 1 || len(attendee.Interests) > 6 {
			t.Fatalf("attendee %d carries %d interests, want 1-6", index, len(attendee.Interests))
		}
		seen := map[string]struct{}{}
		for _, interest := range attendee.Interests {
			if interest != strings.TrimSpace(interest) || interest == "" || len(interest) > 64 {
				t.Fatalf("attendee %d interest %q is out of bounds", index, interest)
			}
			if _, duplicate := seen[interest]; duplicate {
				t.Fatalf("attendee %d repeats the interest %q", index, interest)
			}
			seen[interest] = struct{}{}
			if _, vocabulary := known[interest]; !vocabulary {
				t.Fatalf("attendee %d interest %q matches nothing the seeded events carry", index, interest)
			}
		}
	}
}

// TestCredentialAcceptsTheIdentityArgon2String pins the hash format to the
// string Identity's own argon2 package produces: if the encoding drifts,
// every seeded account stops verifying and no login works.
func TestCredentialAcceptsTheIdentityArgon2String(t *testing.T) {
	// Produced by `argon2.hash("EventaDev!2026", {memoryCost: 65536,
	// parallelism: 4, timeCost: 3, type: argon2id})` from Identity's
	// `argon2@0.44.0` dependency.
	fromIdentity := "$argon2id$v=19$m=65536,t=3,p=4$h81lNVdV4DBpT9mEM06Pmw$BtY04aw9m+uT51f183Tqmv84JqeG/mByWmbx7rQpBwo"

	if !attendeeseed.VerifyPassword(fromIdentity, seedPassword) {
		t.Fatal("a credential written by Identity's own argon2 package must verify")
	}
	if attendeeseed.VerifyPassword(fromIdentity, "EventaDev!2027") {
		t.Fatal("a credential must reject a different password")
	}
	if attendeeseed.VerifyPassword("not-a-hash", seedPassword) {
		t.Fatal("a malformed credential must be rejected instead of accepted")
	}
}
